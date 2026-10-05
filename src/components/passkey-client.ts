"use client";

import { useSyncExternalStore } from "react";
import { browserSupportsWebAuthn, WebAuthnError } from "@simplewebauthn/browser";

const noop = () => () => {};

/** Whether this browser can use passkeys at all. False on the server and in old browsers, so passkey buttons stay hidden. */
export function useWebAuthnSupported(): boolean {
  return useSyncExternalStore(noop, () => browserSupportsWebAuthn(), () => false);
}

/** A short, human message for a failed browser passkey prompt; null when the person simply cancelled. */
export function passkeyErrorMessage(err: unknown): string | null {
  const name = err instanceof Error ? err.name : "";
  const code = err instanceof WebAuthnError ? err.code : "";
  if (code === "ERROR_CEREMONY_ABORTED" || name === "AbortError") return null;
  if (name === "NotAllowedError") return "Cancelled or timed out. Try again when you're ready.";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "This device already has a passkey for your account.";
  if (code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" || code === "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT") {
    return "This device or key can't make a passkey that checks it's you (Face ID, fingerprint or PIN). Try your phone or computer instead.";
  }
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") return "Passkeys only work on the dashboard's main address.";
  return "Your device couldn't complete the passkey. Try again.";
}
