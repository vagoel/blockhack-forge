// Audience SPA: hash routing between the join screen, the stage pointer,
// and per-app routes (waiting screen while building, iframe once live).
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import {
  AppFrame,
  type LiveVersion,
  type Mode,
  type ShellApp,
  type ShellVersion,
} from "./AppFrame";
import { getName, getSessionId, setName as persistName } from "./names";

type Route = { path: string; mode: Mode };

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, "");
  const qIdx = raw.indexOf("?");
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const queryPart = qIdx >= 0 ? raw.slice(qIdx + 1) : "";
  const params = new URLSearchParams(queryPart);
  const mode: Mode = params.get("mode") === "projector" ? "projector" : "player";
  const path = pathPart === "" ? "/" : pathPart;
  return { path, mode };
}

export default function App() {
  const [sessionId] = useState(getSessionId);
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  if (route.path === "/") return <JoinScreen />;
  if (route.path === "/stage") return <StageRoute mode={route.mode} sessionId={sessionId} />;

  const slug = route.path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!slug) return <JoinScreen />;
  return <AppRoute slug={slug} mode={route.mode} sessionId={sessionId} />;
}

// ---------- join ----------

function normalizeCode(raw: string): string {
  let s = raw.trim();
  const hashIdx = s.indexOf("#/");
  if (hashIdx >= 0) s = s.slice(hashIdx + 2);
  return s.replace(/^[#/]+/, "").replace(/\/+$/, "").toLowerCase();
}

function JoinScreen() {
  const [code, setCode] = useState("");

  const go = (e: FormEvent) => {
    e.preventDefault();
    const slug = normalizeCode(code);
    if (slug) window.location.hash = `#/${slug}`;
  };

  return (
    <div className="screen">
      <form className="card" onSubmit={go}>
        <div className="pulse" aria-hidden="true" />
        <h1>Join the show</h1>
        <p className="muted">Enter the app code from the big screen</p>
        <input
          className="join-input"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="app code"
          aria-label="App code"
        />
        <button type="submit" className="btn" disabled={!normalizeCode(code)}>
          Go
        </button>
      </form>
    </div>
  );
}

// ---------- stage ----------

function StageRoute(props: { mode: Mode; sessionId: string }) {
  // Stay subscribed: when the operator moves the stage pointer, the slug
  // prop below changes and the app route swaps live.
  const stage = useQuery(anyApi.apps.getStage, {}) as string | null | undefined;

  if (stage === undefined) return <LoadingScreen />;
  if (!stage) {
    return (
      <div className="screen">
        <div className="card">
          <div className="pulse" aria-hidden="true" />
          <h1>Nothing on stage yet</h1>
          <p className="muted">Hang tight — the show is about to start.</p>
        </div>
      </div>
    );
  }
  return <AppRoute key={stage} slug={stage} mode={props.mode} sessionId={props.sessionId} />;
}

// ---------- app route ----------

type GetBySlugResult = { app: ShellApp; version: ShellVersion | null } | null | undefined;

function AppRoute(props: { slug: string; mode: Mode; sessionId: string }) {
  const { slug, mode, sessionId } = props;
  const result = useQuery(anyApi.apps.getBySlug, { slug }) as GetBySlugResult;
  const [name, setNameState] = useState(() => getName(sessionId));

  const changeName = (next: string) => {
    const clean = persistName(next);
    setNameState(clean);
  };

  if (result === undefined) return <LoadingScreen />;
  if (result === null) return <NotFoundScreen slug={slug} />;

  const { app, version } = result;
  const live =
    app.status === "live" && typeof version?.bundle === "string" && version.bundle.length > 0;

  if (!live || !version) {
    return <WaitingScreen app={app} />;
  }

  return (
    <>
      <AppFrame
        app={app}
        version={version as LiveVersion}
        sessionId={sessionId}
        name={name}
        mode={mode}
      />
      {mode !== "projector" && <NameChip name={name} onChange={changeName} floating />}
    </>
  );
}

function LoadingScreen() {
  return (
    <div className="screen">
      <div className="spinner" aria-label="Loading" />
    </div>
  );
}

function NotFoundScreen(props: { slug: string }) {
  return (
    <div className="screen">
      <div className="card">
        <h1>Nothing here</h1>
        <p className="muted">
          No app answers to <strong>{props.slug}</strong>. Double-check the code on the big screen.
        </p>
        <a className="btn btn--link" href="#/">
          Try another code
        </a>
      </div>
    </div>
  );
}

// ---------- waiting screen ----------

function WaitingScreen(props: { app: ShellApp }) {
  const { app } = props;
  const hitError = app.status === "error";

  return (
    <div className="screen">
      <div className="card">
        <div className="pulse" aria-hidden="true" />
        <h1>{app.name || app.slug}</h1>
        <p className="building">
          {hitError ? "hit a snag — hang tight" : "being built"}
          <span className="dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      </div>
    </div>
  );
}

// ---------- name chip ----------

function NameChip(props: { name: string; onChange: (name: string) => void; floating?: boolean }) {
  const { name, onChange, floating } = props;
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => setDraft(name), [name]);

  // Floating chip collapses to a small badge after a moment.
  useEffect(() => {
    if (!floating || editing || collapsed) return;
    const t = setTimeout(() => setCollapsed(true), 5000);
    return () => clearTimeout(t);
  }, [floating, editing, collapsed]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onChange(draft);
    else setDraft(name);
  };

  const cls = "name-chip" + (floating ? " name-chip--floating" : "");

  if (floating && collapsed && !editing) {
    const initials = name
      .split(/\s+/)
      .map((w) => w.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
    return (
      <div className={cls}>
        <button
          type="button"
          className="name-chip__mini"
          title={`You are ${name} — tap to change`}
          onClick={() => setCollapsed(false)}
        >
          {initials || "?"}
        </button>
      </div>
    );
  }

  return (
    <div className={cls}>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            autoFocus
            value={draft}
            maxLength={24}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            aria-label="Your name"
          />
        </form>
      ) : (
        <button
          type="button"
          className="name-chip__label"
          title="Tap to change your name"
          onClick={() => setEditing(true)}
        >
          you are <strong>{name}</strong>
          <span className="name-chip__edit">edit</span>
        </button>
      )}
    </div>
  );
}
