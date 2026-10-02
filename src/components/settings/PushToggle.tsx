"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { subscribePush, testPush, unsubscribePush } from "@/app/actions/push";

const btn = "hud-btn min-h-10 [--b:#ff5fd7] sm:min-h-0";

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turns push notifications on or off for this device. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.register("/sw.js").then((reg) => reg.pushManager.getSubscription()).then(setSub).catch(() => setSupported(false));
  }, []);

  if (!publicKey) return <p className="text-sm text-muted">Set <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> on the server to enable push (the README shows how to generate them).</p>;
  if (supported === null) return null;
  if (!supported) return <p className="text-sm text-muted">This browser can&apos;t receive push notifications. On iPhone, add the dashboard to your Home Screen first (Share → Add to Home Screen), then open it from there.</p>;

  const enable = () =>
    start(async () => {
      setMsg(null);
      if ((await Notification.requestPermission()) !== "granted") return setMsg({ error: "Notifications are blocked for this site in the browser settings." });
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const r = await subscribePush(s.toJSON(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (r.error) {
        await s.unsubscribe();
        return setMsg({ error: r.error });
      }
      setSub(s);
      setMsg({ ok: "On for this device." });
    });
  const disable = () =>
    start(async () => {
      if (!sub) return;
      await unsubscribePush(sub.endpoint);
      await sub.unsubscribe();
      setSub(null);
      setMsg({ ok: "Off for this device." });
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sub ? (
        <>
          <span className="mr-auto flex items-center gap-2.5 text-sm"><span className="relative inline-block h-5 w-9 border border-emerald/60 bg-emerald/15"><i className="absolute right-0.5 top-0.5 h-3.5 w-3.5 bg-emerald shadow-[0_0_8px_#3df5a0]" /></span>On for this device</span>
          <button className={btn} disabled={pending} onClick={() => start(async () => setMsg(await testPush()))}><Bell size={14} />Send a test</button>
          <button className={btn} disabled={pending} onClick={disable}><BellOff size={14} />Turn off</button>
        </>
      ) : (
        <>
          <span className="mr-auto flex items-center gap-2.5 text-sm text-muted"><span className="relative inline-block h-5 w-9 border border-line bg-line/30"><i className="absolute left-0.5 top-0.5 h-3.5 w-3.5 bg-muted/60" /></span>Off for this device</span>
          <button className={`${btn} hud-btn-solid`} disabled={pending} onClick={enable}><Bell size={14} />Enable on this device</button>
        </>
      )}
      {msg && <span className={`basis-full text-sm ${msg.error ? "text-critical" : "text-emerald"}`}>{msg.error ?? msg.ok}</span>}
    </div>
  );
}
