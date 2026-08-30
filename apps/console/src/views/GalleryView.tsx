import { type CSSProperties, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { api, SHELL_URL } from "../convexClient";
import { useOperatorKey } from "../operator";

type AppRow = {
  _id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: number;
  prompt: string;
  connectors: string[];
  productionUrl?: string;
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase() || "APP";
}

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minutes = Math.max(1, Math.floor(delta / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}

export default function GalleryView() {
  const operatorKey = useOperatorKey();
  const apps = useQuery(api.apps.list, { operatorKey }) as AppRow[] | undefined;
  const stage = useQuery(api.apps.getStage, {}) as string | null | undefined;

  return (
    <section className="projects-page">
      <header className="page-header">
        <div>
          <span className="section-kicker">Your workspace</span>
          <h1>Projects</h1>
          <p>Open, present, and refine every live experience you have built.</p>
        </div>
        <a className="btn btn-primary" href="#/build">New app <span aria-hidden="true">+</span></a>
      </header>

      <div className="stage-banner">
        <span className="stage-signal" aria-hidden="true"><span /></span>
        <div>
          <span className="section-kicker">Live stage</span>
          <strong>{stage ? stage : "No project is on stage"}</strong>
        </div>
        <p>{stage ? "Your stage pointer is ready for the next audience." : "Choose a project below when you are ready to present."}</p>
        <a className="btn" href={`${SHELL_URL}/#/stage`} target="_blank" rel="noreferrer">
          Open stage <span aria-hidden="true">↗</span>
        </a>
      </div>

      {apps === undefined ? (
        <div className="project-grid" aria-label="Loading projects">
          {[0, 1, 2].map((item) => <div className="project-card project-card-skeleton" key={item} />)}
        </div>
      ) : apps.length === 0 ? (
        <div className="page-state projects-empty">
          <span className="state-glyph">+</span>
          <h2>Your first live app starts with one sentence.</h2>
          <p>Describe a room experience and Builder will make it shareable.</p>
          <a className="btn btn-primary" href="#/build">Create an app</a>
        </div>
      ) : (
        <div className="project-grid">
          {apps.map((app, index) => (
            <AppCard
              key={app._id}
              app={app}
              index={index}
              isStage={app.slug === stage}
              operatorKey={operatorKey}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AppCard({
  app,
  index,
  isStage,
  operatorKey,
}: {
  app: AppRow;
  index: number;
  isStage: boolean;
  operatorKey: string;
}) {
  const setStage = useMutation(api.apps.setStage);
  const retheme = useAction(api.contextdev.retheme);

  const [rethemeUrl, setRethemeUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const shellUrl = `${SHELL_URL}/#/${app.slug}`;
  const appUrl = app.productionUrl ?? shellUrl;
  const contextEnabled = app.connectors.includes("context");
  const hue = [252, 166, 28, 204, 330][index % 5];

  async function onSetStage() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await setStage({ slug: app.slug, operatorKey });
      setNote({ ok: true, text: "This project is now on stage." });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRetheme() {
    const url = rethemeUrl.trim();
    if (!url || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const applied = await retheme({ slug: app.slug, url, operatorKey });
      if (!applied) throw new Error("Context.dev could not extract a theme from that URL");
      setRethemeUrl("");
      setNote({ ok: true, text: "Theme applied." });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={`project-card${isStage ? " is-on-stage" : ""}`}
      style={{ "--project-hue": hue } as CSSProperties}
    >
      <div className="project-card-preview">
        <span className="preview-orbit orbit-one" aria-hidden="true" />
        <span className="preview-orbit orbit-two" aria-hidden="true" />
        <div className="project-mini-app">
          <span>{initials(app.name)}</span>
          <strong>{app.name}</strong>
          <small>{app.status === "live" ? "Ready to join" : "Building now"}</small>
          <i aria-hidden="true" />
        </div>
        {isStage ? <span className="on-stage-pill"><span /> On stage</span> : null}
      </div>

      <div className="project-card-body">
        <div className="project-card-title">
          <div>
            <h2>{app.name}</h2>
            <span>{relativeTime(app.createdAt)}</span>
          </div>
          <span className={`badge badge-${app.status}`}>{app.status}</span>
        </div>
        <p className="project-prompt">{app.prompt}</p>
        <code className="project-slug">/{app.slug}</code>
        <div className="project-tech" aria-label="Enabled connectors">
          {app.connectors.map((connector) => (
            <span key={connector}><i aria-hidden="true" />{connector}</span>
          ))}
          {app.productionUrl ? <span className="production-ready"><i aria-hidden="true" />Production live</span> : null}
        </div>

        <div className="project-card-actions">
          <a className="btn btn-primary" href={appUrl} target="_blank" rel="noreferrer">
            Open app <span aria-hidden="true">↗</span>
          </a>
          <a className="btn" href={`#/projector/${app.slug}`}>Present</a>
          <button className="btn btn-icon" type="button" onClick={onSetStage} disabled={busy || isStage} title="Set this project on stage">
            {isStage ? "✓" : "●"}
          </button>
        </div>

        <details className="project-tools">
          <summary>Share & appearance <span aria-hidden="true">⌄</span></summary>
          <div className="project-tools-grid">
            <div className="share-qr">
              <div className="qr-box"><QRCode value={appUrl} size={104} /></div>
              <span>Scan to join</span>
            </div>
            {contextEnabled ? (
              <div className="retheme-control">
                <label htmlFor={`retheme-${app._id}`}>Style like a URL</label>
                <input
                  id={`retheme-${app._id}`}
                  className="input"
                  type="url"
                  value={rethemeUrl}
                  onChange={(event) => setRethemeUrl(event.target.value)}
                  placeholder="https://brand.com"
                />
                <button className="btn btn-sm" type="button" onClick={onRetheme} disabled={busy || !rethemeUrl.trim()}>
                  {busy ? "Working…" : "Apply theme"}
                </button>
              </div>
            ) : null}
          </div>
        </details>

        {note ? <div className={`note ${note.ok ? "note-ok" : "note-err"}`}>{note.text}</div> : null}
      </div>
    </article>
  );
}
