// Control-plane functions retain an empty compatibility argument until the
// next API cleanup, but the builder is intentionally public and has no lock.
export function useOperatorKey(): string {
  // Local UI testing can bridge the pre-deployment backend with a dev-only
  // environment value. Production clients always use the public empty token.
  if (import.meta.env.DEV) return import.meta.env.VITE_OPERATOR_KEY ?? "";
  return "";
}
