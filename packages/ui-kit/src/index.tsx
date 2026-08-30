// @app-builder/ui-kit — window.RuntimeUI
// Themed component kit every generated app inherits. Styled entirely via
// classnames in `baseCss`, which reference the --rt-* CSS vars set by the
// runtime boot (see packages/runtime-sdk/src/boot.tsx). No deps beyond react.
import * as React from "react";

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export interface ScreenProps {
  title?: string;
  children?: React.ReactNode;
}

/** Page wrapper: safe-area padding, centered column, subtle themed glow. */
export function Screen({ title, children }: ScreenProps) {
  return (
    <div className="rt-screen">
      {title ? <h1 className="rt-screen-title">{title}</h1> : null}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps {
  title?: string;
  children?: React.ReactNode;
}

export function Card({ title, children }: CardProps) {
  return (
    <section className="rt-card">
      {title ? <h2 className="rt-card-title">{title}</h2> : null}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// BigButton
// ---------------------------------------------------------------------------

export interface BigButtonProps {
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  children?: React.ReactNode;
}

export function BigButton({
  onClick,
  disabled,
  variant = "primary",
  children,
}: BigButtonProps) {
  return (
    <button
      type="button"
      className={`rt-btn rt-btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputProps {
  value: string;
  /** Called with the new string value on every keystroke. */
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}

export function Input({ value, onChange, placeholder, type = "text" }: InputProps) {
  return (
    <input
      className="rt-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
    />
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface ListProps {
  items: React.ReactNode[];
}

export function List({ items }: ListProps) {
  return (
    <ul className="rt-list">
      {items.map((item, i) => (
        <li className="rt-list-item" key={i}>
          {item}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface LeaderboardEntry {
  name: string;
  points: number;
  highlight?: boolean;
}

export interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

export function Leaderboard({ entries }: LeaderboardProps) {
  if (entries.length === 0) {
    return <EmptyState message="No scores yet — be the first!" />;
  }
  return (
    <ol className="rt-leaderboard">
      {entries.map((e, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? ` rt-lb-rank-${rank}` : "";
        return (
          <li
            className={`rt-lb-row${e.highlight ? " rt-highlight" : ""}`}
            key={`${e.name}-${i}`}
          >
            <span className={`rt-lb-rank${rankClass}`}>{rank}</span>
            <Avatar name={e.name} />
            <span className="rt-lb-name">{e.name}</span>
            <span className="rt-lb-points">{e.points}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// PresencePill
// ---------------------------------------------------------------------------

export interface PresencePillProps {
  count: number;
}

export function PresencePill({ count }: PresencePillProps) {
  return (
    <span className="rt-presence">
      <span className="rt-presence-dot" aria-hidden="true" />
      {count} {count === 1 ? "player" : "players"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CountdownTimer
// ---------------------------------------------------------------------------

export interface CountdownTimerProps {
  /** Epoch ms when the countdown hits zero. */
  endsAt: number;
  /** Fired exactly once per `endsAt` when the countdown crosses 0. */
  onEnd?: () => void;
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function CountdownTimer({ endsAt, onEnd }: CountdownTimerProps) {
  const [now, setNow] = React.useState<number>(() => Date.now());
  const firedRef = React.useRef(false);
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;

  React.useEffect(() => {
    firedRef.current = false;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt && !firedRef.current) {
        firedRef.current = true;
        onEndRef.current?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const remaining = endsAt - now;
  const done = remaining <= 0;
  const urgent = !done && remaining <= 10_000;
  const cls = `rt-timer${urgent ? " rt-timer-urgent" : ""}${done ? " rt-timer-done" : ""}`;
  return (
    <span className={cls} role="timer">
      {formatRemaining(remaining)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export interface AvatarProps {
  name: string;
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return h;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const second = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + second).toUpperCase();
}

export function Avatar({ name }: AvatarProps) {
  const hue = ((hashName(name) % 360) + 360) % 360;
  const style: React.CSSProperties = {
    background: `linear-gradient(135deg, hsl(${hue} 70% 48%), hsl(${(hue + 40) % 360} 72% 38%))`,
  };
  return (
    <span className="rt-avatar" style={style} title={name}>
      {initialsOf(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="rt-empty">
      <svg
        className="rt-empty-glyph"
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="18"
          cy="18"
          r="15"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="4 6"
          strokeLinecap="round"
        />
        <circle cx="18" cy="18" r="4" fill="currentColor" opacity="0.5" />
      </svg>
      <p>{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export interface GridProps {
  cols: number;
  children?: React.ReactNode;
}

export function Grid({ cols, children }: GridProps) {
  const style: React.CSSProperties = {
    gridTemplateColumns: `repeat(${Math.max(1, Math.floor(cols))}, minmax(0, 1fr))`,
  };
  return (
    <div className="rt-grid" style={style}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat
// ---------------------------------------------------------------------------

export interface StatProps {
  label: string;
  value: React.ReactNode;
}

export function Stat({ label, value }: StatProps) {
  return (
    <div className="rt-stat">
      <span className="rt-stat-label">{label}</span>
      <span className="rt-stat-value">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// baseCss — reset + tokens + component styles, injected into the iframe.
// The boot script sets --rt-* inline on <html>, which overrides these
// :root fallbacks; everything below only ever references the vars.
// ---------------------------------------------------------------------------

export const baseCss: string = `
/* ===== tokens (fallbacks; boot overrides inline on <html>) ===== */
:root {
  --rt-primary: #4f46e5;
  --rt-secondary: #818cf8;
  --rt-background: #0b0d14;
  --rt-surface: #171a26;
  --rt-text: #f4f5f9;
  --rt-accent: #f59e0b;
  --rt-radius: 14px;
  --rt-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  /* derived */
  --rt-muted: color-mix(in srgb, var(--rt-text) 55%, transparent);
  --rt-border: color-mix(in srgb, var(--rt-text) 12%, transparent);
  --rt-danger: #ef4444;
  --rt-success: #34d399;
}

/* ===== reset ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
html, body { height: 100%; }
body {
  background: var(--rt-background);
  color: var(--rt-text);
  font-family: var(--rt-font);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
#root { min-height: 100%; }
img, svg, video { display: block; max-width: 100%; }
button, input, select, textarea { font: inherit; color: inherit; }
button { background: none; border: none; cursor: pointer; }
a { color: var(--rt-accent); }
ul, ol { list-style: none; }
::selection { background: color-mix(in srgb, var(--rt-primary) 40%, transparent); }
:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--rt-primary) 80%, var(--rt-text));
  outline-offset: 2px;
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--rt-border); border-radius: 999px; }

@keyframes rt-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: none; }
}
@keyframes rt-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--rt-success) 55%, transparent); }
  70% { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes rt-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* ===== Screen ===== */
.rt-screen {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 680px;
  margin: 0 auto;
  min-height: 100vh;
  min-height: 100dvh;
  padding: calc(20px + env(safe-area-inset-top, 0px))
           calc(16px + env(safe-area-inset-right, 0px))
           calc(28px + env(safe-area-inset-bottom, 0px))
           calc(16px + env(safe-area-inset-left, 0px));
  background: radial-gradient(
    1100px 520px at 50% -12%,
    color-mix(in srgb, var(--rt-primary) 16%, transparent),
    transparent 62%
  );
  animation: rt-in 0.3s ease-out;
}
.rt-screen-title {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

/* ===== Card ===== */
.rt-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--rt-surface);
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius);
  padding: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), 0 8px 24px rgba(0, 0, 0, 0.12);
  animation: rt-in 0.25s ease-out;
}
.rt-card-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rt-muted);
}

/* ===== BigButton ===== */
.rt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 52px;
  padding: 14px 20px;
  border-radius: var(--rt-radius);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.01em;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: transform 0.15s ease, filter 0.15s ease, box-shadow 0.2s ease,
    opacity 0.15s ease;
}
.rt-btn:active:not(:disabled) { transform: scale(0.97); }
.rt-btn:hover:not(:disabled) { filter: brightness(1.08); }
.rt-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.rt-btn-primary {
  background: var(--rt-primary);
  color: #fff;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--rt-primary) 35%, transparent);
}
.rt-btn-secondary {
  background: color-mix(in srgb, var(--rt-text) 8%, transparent);
  color: var(--rt-text);
  border: 1px solid var(--rt-border);
}
.rt-btn-danger {
  background: var(--rt-danger);
  color: #fff;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--rt-danger) 30%, transparent);
}

/* ===== Input ===== */
.rt-input {
  width: 100%;
  min-height: 52px;
  padding: 12px 16px;
  font-size: 16px;
  background: var(--rt-surface);
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius);
  color: var(--rt-text);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.rt-input::placeholder { color: var(--rt-muted); }
.rt-input:focus {
  outline: none;
  border-color: var(--rt-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--rt-primary) 25%, transparent);
}

/* ===== List ===== */
.rt-list { display: flex; flex-direction: column; gap: 8px; }
.rt-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 12px 16px;
  background: var(--rt-surface);
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius);
  animation: rt-in 0.25s ease-out;
}

/* ===== Leaderboard ===== */
.rt-leaderboard { display: flex; flex-direction: column; gap: 8px; }
.rt-lb-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 14px;
  background: var(--rt-surface);
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius);
  transition: background 0.2s ease, border-color 0.2s ease;
  animation: rt-in 0.25s ease-out;
}
.rt-lb-row.rt-highlight {
  border-color: color-mix(in srgb, var(--rt-accent) 65%, transparent);
  background: color-mix(in srgb, var(--rt-accent) 12%, var(--rt-surface));
}
.rt-lb-rank {
  width: 26px;
  flex-shrink: 0;
  text-align: center;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--rt-muted);
}
.rt-lb-rank-1 { color: #fbbf24; }
.rt-lb-rank-2 { color: #cbd5e1; }
.rt-lb-rank-3 { color: #d97706; }
.rt-lb-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rt-lb-points {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--rt-accent);
}

/* ===== PresencePill ===== */
.rt-presence {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  min-height: 34px;
  border-radius: 999px;
  background: var(--rt-surface);
  border: 1px solid var(--rt-border);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.rt-presence-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--rt-success);
  animation: rt-pulse 2s ease-out infinite;
}

/* ===== CountdownTimer ===== */
.rt-timer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 20px;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
  background: var(--rt-surface);
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius);
  transition: color 0.2s ease, border-color 0.2s ease;
}
.rt-timer-urgent {
  color: var(--rt-danger);
  border-color: color-mix(in srgb, var(--rt-danger) 55%, transparent);
  animation: rt-blink 1s ease-in-out infinite;
}
.rt-timer-done { color: var(--rt-muted); }

/* ===== Avatar ===== */
.rt-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  user-select: none;
  -webkit-user-select: none;
}

/* ===== EmptyState ===== */
.rt-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 44px 20px;
  text-align: center;
  color: var(--rt-muted);
  font-size: 15px;
  animation: rt-in 0.3s ease-out;
}
.rt-empty-glyph { opacity: 0.7; }

/* ===== Grid ===== */
.rt-grid { display: grid; gap: 12px; }

/* ===== Stat ===== */
.rt-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  background: var(--rt-surface);
  border: 1px solid var(--rt-border);
  border-radius: var(--rt-radius);
  animation: rt-in 0.25s ease-out;
}
.rt-stat-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--rt-muted);
}
.rt-stat-value {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
`;
