import { type CSSProperties, type FormEvent, type KeyboardEvent, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import ConnectorRail, { type ConnectorReadiness } from "../components/ConnectorRail";
import {
  CONNECTORS,
  DEFAULT_CONNECTORS,
  orderedConnectors,
  type ConnectorId,
} from "../connectors";
import { api, SHELL_URL } from "../convexClient";
import { useOperatorKey } from "../operator";

type BuildEvent = { ts: number; kind: string; message: string };

type BuildRecord = {
  _id: string;
  prompt: string;
  styleUrl?: string;
  status: string;
  appSlug?: string;
  error?: string;
  createdAt: number;
  connectors?: string[];
  deploymentUrl?: string;
  vercelUrl?: string;
  deploymentStatus?: string;
  productionUrl?: string;
  devinMode?: string;
};

type DevinSession = {
  _id: string;
  buildId: string;
  status: string;
  statusDetail?: string;
  terminal: boolean;
  updatedAt: number;
  acus?: number;
  url?: string;
  prUrl?: string;
};

const STAGES = [
  { label: "Prepare", statuses: ["queued", "grounding"] },
  { label: "Generate", statuses: ["generating"] },
  { label: "Compile", statuses: ["awaiting_compile"] },
  { label: "Deploy", statuses: ["queued_deploy", "deploying"] },
  { label: "Live", statuses: ["live"] },
] as const;

const STARTERS = [
  {
    title: "Product launch site",
    detail: "A sharp story, responsive sections, and a clear CTA",
    prompt:
      "Build a polished responsive launch website for a modern software product, with a high-impact hero, specific feature storytelling, product proof, pricing, FAQ, and a strong final call to action. Make it feel bespoke rather than template-like.",
    tags: ["Context", "Vercel"],
    tone: "violet",
  },
  {
    title: "Live auction",
    detail: "Realtime bids, countdowns, and a projector view",
    prompt:
      "Build a polished live auction for three mystery prizes, with a 90-second countdown per lot, participant names, and a big-screen projector view.",
    tags: ["Convex"],
    tone: "mint",
  },
  {
    title: "Data directory",
    detail: "Turn extracted rows into search, filters, and detail views",
    prompt:
      "Create a refined mobile-friendly directory from a public source URL, with useful summaries, local search, filters, sorting, a detail view, clear provenance, and an excellent empty state.",
    tags: ["Context"],
    tone: "amber",
  },
  {
    title: "AI workspace",
    detail: "A focused assistant with polished loading and result states",
    prompt:
      "Build a polished AI writing workspace that helps turn a rough brief into a structured launch narrative, with guided inputs, explicit generation, useful loading and error states, and editable local results.",
    tags: ["OpenAI"],
    tone: "sky",
  },
] as const;

type DevinMode = "default" | "normal" | "fast" | "lite" | "ultra" | "fusion";

const DEVIN_MODES: ReadonlyArray<{
  id: DevinMode;
  label: string;
  description: string;
  meta: string;
  badge: string;
}> = [
  {
    id: "default",
    label: "Organization default",
    description: "Use the mode configured by your Devin organization",
    meta: "Speed and cost follow organization settings",
    badge: "Recommended",
  },
  {
    id: "normal",
    label: "Agent (Normal)",
    description: "Standard agent mode for deliberate, long-horizon work",
    meta: "Standard speed · standard cost",
    badge: "Standard",
  },
  {
    id: "fast",
    label: "Fast",
    description: "Same intelligence at higher throughput",
    meta: "~2× faster · ~4× cost",
    badge: "Speed",
  },
  {
    id: "lite",
    label: "Lite (Preview)",
    description: "Preview mode for eligible Devin organizations",
    meta: "Availability and metering are provider-controlled",
    badge: "Preview",
  },
  {
    id: "ultra",
    label: "Ultra (Preview)",
    description: "Preview mode for eligible Devin organizations",
    meta: "Availability and metering are provider-controlled",
    badge: "Preview",
  },
  {
    id: "fusion",
    label: "Fusion (Preview)",
    description: "Preview mode for eligible Devin organizations",
    meta: "Availability and metering are provider-controlled",
    badge: "Preview",
  },
] as const;

export default function BuildView({ buildId }: { buildId: string | null }) {
  return buildId ? <BuildDetail buildId={buildId} /> : <BuildForm />;
}

function BuildForm() {
  const operatorKey = useOperatorKey();
  const requestBuild = useMutation(api.builds.request);
  const readiness = useQuery(api.connectors.status, { operatorKey }) as
    | ConnectorReadiness
    | undefined;
  const devinCapabilities = useQuery(api.devin.capabilities, { operatorKey }) as
    | { apiVersion: string; supportedModes: string[] }
    | undefined;
  const [prompt, setPrompt] = useState("");
  const [styleUrl, setStyleUrl] = useState("");
  const [devinMode, setDevinMode] = useState<DevinMode>("default");
  const [selected, setSelected] = useState<Set<ConnectorId>>(
    () => new Set(DEFAULT_CONNECTORS),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextEnabled = selected.has("context");
  const selectedDefinitions = CONNECTORS.filter((connector) => selected.has(connector.id));
  const missingConnectors = readiness
    ? orderedConnectors(selected).filter((id) => !readiness[id])
    : [];
  const readyToBuild = Boolean(readiness) && missingConnectors.length === 0;
  const selectedMode = DEVIN_MODES.find((mode) => mode.id === devinMode) ?? DEVIN_MODES[0];

  function modeSupported(mode: DevinMode): boolean {
    if (mode === "default") return true;
    return devinCapabilities?.supportedModes.includes(mode) ?? false;
  }

  function toggleConnector(id: ConnectorId) {
    if (id === "vercel") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = contextEnabled ? styleUrl.trim() : "";
      const requestArgs = {
        prompt: trimmed,
        connectors: orderedConnectors(selected),
        styleUrl: url || undefined,
        devinMode,
        operatorKey,
      };
      const result = (await requestBuild(requestArgs)) as {
        buildId: string;
        appSlug: string;
      };
      window.location.hash = `#/build/${result.buildId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="build-studio">
      <section className="builder-home" aria-labelledby="builder-heading">
        <div className="hero-signal" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="builder-hero">
          <span className="section-kicker">AI product studio</span>
          <h1 id="builder-heading">Turn an idea into a polished product.</h1>
          <p>
            Describe the site or app, choose its capabilities, then publish it to a shareable URL.
          </p>
        </div>

        <form className="prompt-composer" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="prompt">Describe the app to build</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder="Build a polished launch site for a modern software product…"
            autoFocus
          />

          {contextEnabled ? (
            <div className="reference-field">
              <span className="reference-icon" aria-hidden="true">↗</span>
              <label htmlFor="styleUrl">Ground the look in a URL</label>
              <input
                id="styleUrl"
                type="url"
                value={styleUrl}
                onChange={(event) => setStyleUrl(event.target.value)}
                placeholder="https://your-brand.com"
              />
            </div>
          ) : null}

          <fieldset className="devin-mode-picker">
            <legend className="sr-only">Choose a Devin Cloud mode</legend>
            <div className="devin-mode-heading">
              <span className="devin-mode-mark" aria-hidden="true">D</span>
              <span>
                <strong>Devin Cloud mode</strong>
                <small>Provider mode used for this build</small>
              </span>
            </div>
            <div className="devin-mode-control">
              <div className="devin-mode-select-wrap">
                <select
                  value={devinMode}
                  onChange={(event) => setDevinMode(event.target.value as DevinMode)}
                  aria-label="Devin Cloud mode"
                  aria-describedby="devin-mode-description devin-model-boundary"
                >
                  {DEVIN_MODES.map((mode) => {
                    const supported = modeSupported(mode.id);
                    return (
                      <option value={mode.id} disabled={!supported} key={mode.id}>
                        {mode.label}{supported ? "" : " — unavailable"}
                      </option>
                    );
                  })}
                </select>
                <span aria-hidden="true">⌄</span>
              </div>
              <div className="devin-mode-summary" id="devin-mode-description">
                <span><strong>{selectedMode.label}</strong><em>{selectedMode.badge}</em></span>
                <small>{selectedMode.description}</small>
                <span>{selectedMode.meta}</span>
              </div>
            </div>
            <p className="devin-mode-note" id="devin-model-boundary">
              The underlying model is managed by Devin. Cloud Sessions cannot pin SOL,
              Fable, or Opus 4.8; those choices are available only in Devin CLI.
            </p>
            {devinCapabilities?.apiVersion === "v1" ? (
              <p className="devin-mode-note">
                Named modes require a Devin v3 service-user key. Organization default is ready on this V1 connection.
              </p>
            ) : devinCapabilities && DEVIN_MODES.some((mode) => !modeSupported(mode.id)) ? (
              <p className="devin-mode-note">Modes not enabled for this organization remain unavailable.</p>
            ) : null}
          </fieldset>

          <div className="composer-footer">
            <div className="composer-capabilities" aria-label="Enabled capabilities">
              {selectedDefinitions.map((connector) => (
                <span
                  className="capability-chip"
                  key={connector.id}
                  style={{ "--chip-color": connector.color } as CSSProperties}
                >
                  <span aria-hidden="true" />
                  {connector.name}
                </span>
              ))}
            </div>
            <div className="composer-submit-wrap">
              <span className="keyboard-hint">⌘ ↵</span>
              <button
                className="build-submit"
                type="submit"
                disabled={submitting || !prompt.trim() || !readyToBuild}
              >
                {submitting ? (
                  <><span className="button-spinner" />Starting</>
                ) : (
                  <>Build app <span aria-hidden="true">→</span></>
                )}
              </button>
            </div>
          </div>
          {missingConnectors.length > 0 ? (
            <div className="connector-warning">
              Configure {missingConnectors.map((id) => CONNECTORS.find((item) => item.id === id)?.name ?? id).join(", ")} before starting this build.
            </div>
          ) : null}
          {error ? <div className="error-banner composer-error">{error}</div> : null}
        </form>

        <div className="starter-section">
          <div className="starter-heading">
            <div>
              <span className="section-kicker">Suggested starts</span>
              <h2>Start with a product shape</h2>
            </div>
            <span>Choosing one only fills the prompt</span>
          </div>
          <div className="starter-grid">
            {STARTERS.map((starter) => (
              <button
                className={`starter-card starter-${starter.tone}`}
                key={starter.title}
                type="button"
                onClick={() => setPrompt(starter.prompt)}
              >
                <span className="starter-art" aria-hidden="true"><span /></span>
                <span className="starter-copy">
                  <strong>{starter.title}</strong>
                  <span>{starter.detail}</span>
                  <small>{starter.tags.join(" + ")} recommended</small>
                </span>
                <span className="starter-arrow" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <ConnectorRail selected={selected} readiness={readiness} onToggle={toggleConnector} />
    </div>
  );
}

function stageIndex(status: string): number {
  if (status === "error") return -1;
  const index = STAGES.findIndex((stage) => (stage.statuses as readonly string[]).includes(status));
  return index === -1 ? 0 : index;
}

function Timeline({ status }: { status: string }) {
  const current = stageIndex(status);
  return (
    <ol className="timeline" aria-label={`Build status: ${status.replace(/_/g, " ")}`}>
      {STAGES.map((stage, index) => {
        const done = status === "live" || index < current;
        const active = status !== "error" && index === current && !done;
        return (
          <li key={stage.label} className={`step${done ? " done" : ""}${active ? " current" : ""}`}>
            <span className="step-dot">{done ? "✓" : index + 1}</span>
            <span className="step-label">{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type SessionTone = "active" | "waiting" | "complete" | "error" | "paused";

function buildStatusLabel(build: BuildRecord, pipelineStatus: string): string {
  if (build.status === "error") return "Needs attention";
  const labels: Record<string, string> = {
    queued: "Preparing",
    grounding: "Gathering context",
    generating: "Generating",
    awaiting_compile: "Compiling",
    queued_deploy: "Queued to deploy",
    deploying: "Deploying",
    live: "Live",
  };
  return labels[pipelineStatus] ?? pipelineStatus.replace(/_/g, " ");
}

function describeSession(
  session: DevinSession,
  build: BuildRecord,
  current: boolean,
): { label: string; detail: string; tone: SessionTone } {
  if (current && build.status === "awaiting_compile") {
    return { label: "Generation complete", detail: "Devin delivered the source. The builder is compiling it now.", tone: "complete" };
  }
  if (current && build.status === "live") {
    const deploying = build.deploymentStatus && build.deploymentStatus !== "ready";
    return {
      label: "Generation complete",
      detail: deploying ? "The source is compiled and its production deployment is underway." : "The generated app is compiled and live.",
      tone: "complete",
    };
  }
  if (current && build.status === "error") {
    return { label: "Build needs attention", detail: build.error ?? "Review the build log, then send Devin guidance.", tone: "error" };
  }
  if (
    session.status === "blocked" ||
    session.status === "waiting_for_user" ||
    session.statusDetail === "waiting_for_user"
  ) {
    return { label: "Waiting for your reply", detail: "Devin needs a decision or more detail before continuing.", tone: "waiting" };
  }
  if (session.statusDetail === "waiting_for_approval") {
    return { label: "Waiting for approval", detail: "Review the request and tell Devin how to proceed.", tone: "waiting" };
  }
  if (session.status === "error" || session.status === "expired") {
    return { label: "Session ended", detail: "Send a message to ask Devin to resume or clarify the next step.", tone: "error" };
  }
  if (session.status === "completed" || session.terminal) {
    return { label: "Generation complete", detail: "Devin finished this generation pass. You can still request a refinement.", tone: "complete" };
  }
  if (session.status === "suspended") {
    return { label: "Session paused", detail: "Send a message when you are ready to continue.", tone: "paused" };
  }
  return { label: "Devin is building", detail: "You can add guidance while generation is in progress.", tone: "active" };
}

function BuildDetail({ buildId }: { buildId: string }) {
  const operatorKey = useOperatorKey();
  const feed = useQuery(api.builds.feed, { buildId, operatorKey }) as
    | { build: BuildRecord; events: BuildEvent[] }
    | null
    | undefined;
  const sessions = useQuery(api.devin.sessionsForBuild, { buildId, operatorKey }) as
    | DevinSession[]
    | undefined;
  const sendReply = useAction(api.devin.reply);

  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyNote, setReplyNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (feed === undefined) {
    return (
      <div className="page-state page-state-loading">
        <span className="large-spinner" />
        <strong>Opening the build workspace…</strong>
      </div>
    );
  }
  if (feed === null || !feed.build) {
    return (
      <div className="page-state">
        <span className="state-glyph">?</span>
        <h1>Build not found</h1>
        <p>The build may have been removed or the link is incomplete.</p>
        <a className="btn btn-primary" href="#/build">Start a new app</a>
      </div>
    );
  }

  const { build, events } = feed;
  const buildSessions = sessions ?? [];
  const replySession = buildSessions[0];
  const conversation = events.filter((event) => event.kind === "devin-user" || event.kind === "devin-message");
  const appUrl = build.appSlug ? `${SHELL_URL}/#/${build.appSlug}` : null;
  const deploymentUrl = build.productionUrl ?? build.deploymentUrl ?? build.vercelUrl;
  const pipelineStatus =
    build.status === "live" && build.deploymentStatus && build.deploymentStatus !== "ready"
      ? build.deploymentStatus === "queued"
        ? "queued_deploy"
        : build.deploymentStatus === "error"
          ? "deploying"
          : build.deploymentStatus
      : build.status;
  const title = build.prompt.length > 64 ? `${build.prompt.slice(0, 64).trim()}…` : build.prompt;
  const statusLabel = buildStatusLabel(build, pipelineStatus);
  const replySessionState = replySession ? describeSession(replySession, build, true) : null;

  async function onReply(e: FormEvent) {
    e.preventDefault();
    const message = replyText.trim();
    if (!message || !replySession || replying) return;
    setReplying(true);
    setReplyNote(null);
    try {
      await sendReply({ sessionDocId: replySession._id, message, operatorKey });
      setReplyText("");
      setReplyNote({
        ok: true,
        text: replySessionState?.tone === "waiting" ? "Reply sent. Devin is resuming." : "Message sent to Devin.",
      });
    } catch (err) {
      setReplyNote({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setReplying(false);
    }
  }

  function onReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="build-detail-page">
      <header className="project-header">
        <div className="project-heading">
          <div className="project-breadcrumbs">
            <a href="#/gallery">Projects</a><span>/</span><span>Build workspace</span>
          </div>
          <div className="project-title-row">
            <h1>{title}</h1>
            <span className={`badge badge-${pipelineStatus}`}>{statusLabel}</span>
          </div>
          <p>Started {new Date(build.createdAt).toLocaleString()}</p>
        </div>
        <div className="project-actions">
          <a className="btn" href="#/build">New app</a>
          {appUrl ? <a className="btn" href={`#/projector/${build.appSlug}`}>Present</a> : null}
          {appUrl ? (
            <a className="btn btn-primary" href={deploymentUrl ?? appUrl} target="_blank" rel="noreferrer">
              Open app <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
      </header>

      {replySession && replySessionState ? (
        <section className={`agent-conversation-card is-${replySessionState.tone}`}>
          <div className="agent-conversation-head">
            <div className="agent-avatar" aria-hidden="true">D</div>
            <div className="agent-conversation-copy">
              <span className="section-kicker">Devin conversation</span>
              <h2>{replySessionState.label}</h2>
              <p>{replySessionState.detail}</p>
            </div>
            {replySession.url ? <a className="agent-session-link" href={replySession.url} target="_blank" rel="noreferrer">Open session ↗</a> : null}
          </div>
          {conversation.length > 0 ? (
            <div className="agent-thread" aria-label="Conversation with Devin">
              {conversation.map((event, index) => (
                <div className={`agent-message ${event.kind === "devin-user" ? "from-user" : "from-devin"}`} key={`${event.ts}-${index}`}>
                  <div><strong>{event.kind === "devin-user" ? "You" : "Devin"}</strong><time>{fmtTs(event.ts)}</time></div>
                  <p>{event.message}</p>
                </div>
              ))}
            </div>
          ) : null}
          <form className="agent-composer" onSubmit={onReply}>
            <textarea
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              onKeyDown={onReplyKeyDown}
              placeholder={replySessionState.tone === "waiting" ? "Reply with the missing detail…" : replySessionState.tone === "complete" ? "Ask Devin for a refinement…" : "Add guidance while Devin works…"}
              aria-label="Message Devin"
            />
            <div className="agent-reply-actions">
              <span aria-live="polite">{replyNote ? <span className={replyNote.ok ? "note-ok" : "note-err"}>{replyNote.text}</span> : <span className="agent-shortcut">⌘ ↵ to send</span>}</span>
              <button className="btn btn-primary" type="submit" disabled={replying || !replyText.trim() || !replySession}>
                {replying ? "Sending…" : "Send message"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="build-detail-grid">
        <div className="build-preview-column">
          <div className="preview-toolbar">
            <div>
              <span className="preview-live-dot" />
              <strong>{build.status === "live" ? "Live preview" : "Waiting-room preview"}</strong>
            </div>
            {appUrl ? <a href={appUrl} target="_blank" rel="noreferrer">Open in a new tab ↗</a> : null}
          </div>
          <div className="preview-stage">
            <div className="preview-glow" aria-hidden="true" />
            {appUrl ? (
              <div className="phone-preview">
                <div className="phone-speaker" aria-hidden="true" />
                <iframe src={appUrl} title="Generated app preview" allow="fullscreen" />
              </div>
            ) : (
              <div className="preview-empty">
                <span className="large-spinner" />
                <strong>Reserving your app URL…</strong>
              </div>
            )}
          </div>
          <div className="prompt-summary">
            <span className="section-kicker">Original brief</span>
            <p>{build.prompt}</p>
            {build.styleUrl ? <a href={build.styleUrl} target="_blank" rel="noreferrer">Style reference ↗</a> : null}
          </div>
        </div>

        <aside className="build-inspector">
          <section className="inspector-card">
            <div className="inspector-heading">
              <div>
                <span className="section-kicker">Pipeline</span>
                <h2>Build progress</h2>
              </div>
              <span className={`badge badge-${pipelineStatus}`}>{statusLabel}</span>
            </div>
            <Timeline status={pipelineStatus} />
            {build.status === "error" ? <div className="error-banner">{build.error ?? "Build failed."}</div> : null}
            {build.deploymentStatus === "error" ? (
              <div className="error-banner">The app is live on its stable link, but its Vercel deployment needs a retry.</div>
            ) : null}
            {build.deploymentStatus === "ready" && deploymentUrl ? (
              <a className="production-link" href={deploymentUrl} target="_blank" rel="noreferrer">
                Production deployment <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </section>

          <section className="inspector-card">
            <div className="inspector-heading">
              <div>
                <span className="section-kicker">Generation</span>
                <h2>Devin session</h2>
              </div>
              {build.devinMode ? (
                <span className={`devin-mode-pill is-${build.devinMode}`}>
                  {DEVIN_MODES.find((mode) => mode.id === build.devinMode)?.label ?? build.devinMode}
                </span>
              ) : null}
            </div>
            {buildSessions.length === 0 ? (
              <p className="empty-copy">The generation session will appear here.</p>
            ) : (
              buildSessions.map((session, index) => {
                const state = describeSession(session, build, index === 0);
                return <div className="session-row" key={session._id}>
                  <div>
                    <span className={`project-status session-tone-${state.tone}`} />
                    <strong>{state.label}</strong>
                  </div>
                  <p>{state.detail}</p>
                  <span>{session.acus === undefined ? "ACU metering pending" : `${session.acus} ACUs`}</span>
                  <div className="session-links">
                    {session.url ? <a href={session.url} target="_blank" rel="noreferrer">Session ↗</a> : null}
                    {session.prUrl ? <a href={session.prUrl} target="_blank" rel="noreferrer">PR ↗</a> : null}
                  </div>
                </div>;
              })
            )}
          </section>

          {build.connectors?.length ? (
            <section className="inspector-card">
              <span className="section-kicker">Authorized</span>
              <h2>Build capabilities</h2>
              <div className="build-connector-chips">
                {build.connectors.map((connector) => <span key={connector}>{connector}</span>)}
              </div>
            </section>
          ) : null}

          <details className="build-log inspector-card" open={build.status === "error"}>
            <summary>
              <span><span className="section-kicker">Technical detail</span><strong>Build log</strong></span>
              <span>{events.length} events</span>
            </summary>
            {events.length === 0 ? (
              <p className="empty-copy">No events yet.</p>
            ) : (
              <ul className="events">
                {events.map((event, index) => (
                  <li key={`${event.ts}-${index}`}>
                    <span className="event-ts">{fmtTs(event.ts)}</span>
                    <span className={`badge badge-${event.kind}`}>{event.kind}</span>
                    <span className="event-msg">{event.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </aside>
      </div>
    </section>
  );
}
