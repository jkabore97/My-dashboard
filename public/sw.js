// Service worker: shows push notifications, handles their buttons, and opens
// the dashboard on click. It doesn't cache pages: the dashboard holds private
// data and must always come from the server with a valid session.
// Bump VERSION when this file changes so browsers pick the new one up quickly.
const VERSION = "kcc-sw-4";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const safeUrl = (u) => (typeof u === "string" && u.startsWith("/") && !u.startsWith("//") ? u : "/");

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Kaj Command Center", body: event.data ? event.data.text() : "" };
  }
  const options = {
    body: data.body || "",
    tag: data.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: safeUrl(data.url), id: typeof data.id === "string" ? data.id : null, v: VERSION },
  };
  // A "Resolved" push with the same tag replaces the alert on the device;
  // renotify makes a replacement still buzz.
  if (data.tag) options.renotify = true;
  if (data.requireInteraction) options.requireInteraction = true;
  // Buttons where the platform supports them (iOS ignores actions: tapping opens the page).
  const max = self.Notification && "maxActions" in self.Notification ? self.Notification.maxActions : 2;
  if (Array.isArray(data.actions) && data.id && max > 0) {
    options.actions = data.actions.filter((a) => a && (a.action === "ack" || a.action === "snooze")).slice(0, max).map((a) => ({ action: a.action, title: String(a.title).slice(0, 40) }));
  }
  event.waitUntil(Promise.all([self.registration.showNotification(data.title || "Kaj Command Center", options), setBadge(data.appBadge)]));
});

/** The app icon badge (unread critical/high alerts), where the platform supports it. Never fails. */
function setBadge(n) {
  try {
    const nav = self.navigator;
    if (typeof n !== "number" || !nav) return Promise.resolve();
    if (n > 0 && "setAppBadge" in nav) return nav.setAppBadge(Math.min(n, 99)).catch(() => {});
    if (n <= 0 && "clearAppBadge" in nav) return nav.clearAppBadge().catch(() => {});
  } catch {
    // unsupported: nothing to do
  }
  return Promise.resolve();
}

/** Tells the dashboard about a button press or a tap; the session cookie proves who it is. */
function report(id, action) {
  return fetch("/api/notifications/action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action }),
  });
}

function openPage(path) {
  const url = new URL(path || "/", self.location.origin).href;
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if (w.url.startsWith(self.location.origin) && "focus" in w) {
        return w.focus().then((f) => (f && "navigate" in f ? f.navigate(url) : f)).catch(() => self.clients.openWindow(url));
      }
    }
    return self.clients.openWindow(url);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, id } = event.notification.data || {};
  const action = event.action;
  if (id && (action === "ack" || action === "snooze")) {
    // Done in the background; if the session has expired, open the page to sign in.
    event.waitUntil(
      report(id, action)
        .then((res) => (res.ok ? undefined : openPage(res.status === 401 ? "/login" : url)))
        .catch(() => openPage(url)),
    );
    return;
  }
  event.waitUntil(Promise.all([id ? report(id, "read").catch(() => {}) : Promise.resolve(), openPage(url)]));
});
