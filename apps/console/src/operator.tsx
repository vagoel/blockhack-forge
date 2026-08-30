import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "./convexClient";

const STORAGE_KEY = "app-builder:operator-key";
const OperatorContext = createContext<string | null>(null);

export function loadOperatorKey(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function forgetOperatorKey(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Session storage is a convenience, not an auth requirement.
  }
}

function rememberOperatorKey(value: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Continue for this tab even when storage is unavailable.
  }
}

export function OperatorProvider(props: { operatorKey: string; children: ReactNode }) {
  return (
    <OperatorContext.Provider value={props.operatorKey}>
      {props.children}
    </OperatorContext.Provider>
  );
}

export function useOperatorKey(): string {
  const value = useContext(OperatorContext);
  if (!value) throw new Error("Operator console is locked");
  return value;
}

export function OperatorUnlock(props: { onUnlock: (operatorKey: string) => void }) {
  const verify = useMutation(api.operator.verify);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const operatorKey = draft.trim();
    if (!operatorKey || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await verify({ operatorKey });
      if (!ok) {
        setError("That operator key is not valid.");
        return;
      }
      rememberOperatorKey(operatorKey);
      props.onUnlock(operatorKey);
    } catch {
      setError("Could not verify the key. Check the deployment connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="unlock-screen">
      <form className="card unlock-card" onSubmit={submit}>
        <div className="brand">
          Builder <span>Console</span>
        </div>
        <h1>Unlock the control room</h1>
        <p className="muted">
          Paid builds, publishing, stage controls, and Devin replies require the private operator key.
        </p>
        <div className="field">
          <label htmlFor="operator-key">Operator key</label>
          <input
            id="operator-key"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste your operator key"
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()}>
          {busy ? "Verifying…" : "Unlock console"}
        </button>
        {error ? <div className="error-banner">{error}</div> : null}
      </form>
    </main>
  );
}
