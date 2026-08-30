import { useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { api, SHELL_URL } from "../convexClient";

export default function ProjectorView({ slug }: { slug: string }) {
  const data = useQuery(api.apps.getBySlug, { slug }) as
    | { app: { _id: string; name: string; status: string } }
    | null
    | undefined;

  const joinUrl = `${SHELL_URL}/#/${slug}`;
  const projectorUrl = `${joinUrl}?mode=projector`;

  if (data === undefined) return <div className="projector-loading">Loading projector…</div>;
  if (data === null) {
    return (
      <div className="projector-loading">
        <h1>App not found</h1>
        <a href="#/gallery">Return to gallery</a>
      </div>
    );
  }

  return (
    <div className="projector-live">
      <iframe
        className="projector-frame"
        src={projectorUrl}
        title={`${data.app.name} projector`}
        allow="fullscreen"
      />
      <aside className="projector-overlay" aria-label="Audience join code">
        <div className="qr-box">
          <QRCode value={joinUrl} size={136} />
        </div>
        <div>
          <strong>Scan to join</strong>
          <code>{slug}</code>
        </div>
      </aside>
      <a className="projector-exit" href="#/gallery">
        Exit projector
      </a>
    </div>
  );
}
