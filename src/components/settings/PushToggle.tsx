"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { GroupBody, Row, Switch } from "@/components/ui";
import { subscribePush, testPush, unsubscribePush } from "@/app/actions/push";

const btn = "hud-btn min-h-9 sm:min-h-8";

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turns push notifications on or off for this device. Renders rows for a settings Group. */
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

  if (!publicKey) return <GroupBody className="text-muted">Set <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> on the server to enable push (the README shows how to generate them).</GroupBody>;
  if (supported === null) return <Row label="Push on this device" sub="Checking…" />;
  if (!supported) return <GroupBody className="text-muted">This browser can&apos;t receive push notifications. On iPhone, add the dashboard to your Home Screen first (Share → Add to Home Screen), then open it from there.</GroupBody>;

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
    <>
      <Row label="Push on this device" sub={sub ? "On. Alerts arrive on this phone or computer." : "Off for this device."}>
        <Switch checked={!!sub} disabled={pending} onChange={(on) => (on ? enable() : disable())} label="Push notifications on this device" />
      </Row>
      {sub && (
        <Row label="Test notification" sub="Sends one push to this device.">
          <button className={btn} disabled={pending} onClick={() => start(async () => setMsg(await testPush()))}><Bell size={14} />Send a test</button>
        </Row>
      )}
      {msg && <GroupBody className={`text-[13px] ${msg.error ? "text-critical" : "text-ok"}`}>{msg.error ?? msg.ok}</GroupBody>}
    </>
  );
}
