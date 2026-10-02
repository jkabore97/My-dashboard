import { runAlertsSafe } from "./run";

/**
 * Runs the alert router once the response has been sent (pass next/server's
 * `after`), so webhooks and actions stay fast. Outside a request (tests,
 * scripts) it runs in the background instead. Never throws.
 */
export function alertsAfter(after: (fn: () => Promise<unknown>) => void) {
  const run = () => runAlertsSafe();
  try {
    after(run);
  } catch {
    void run();
  }
}
