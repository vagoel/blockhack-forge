import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { api, SHELL_URL } from "../convexClient";

export default function ProjectorView({ slug }: { slug: string }) {
  const [joinDialogOpen, setJoinDialogOpen] = useState(true);
  const data = useQuery(api.apps.getBySlug, { slug }) as
    | { app: { _id: string; name: string; status: string } }
    | null
    | undefined;

  const joinUrl = `${SHELL_URL}/#/${slug}`;
  const projectorUrl = `${joinUrl}?mode=projector`;

  useEffect(() => {
    if (!joinDialogOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setJoinDialogOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [joinDialogOpen]);

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
      {joinDialogOpen ? (
        <div
          className="projector-qr-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="projector-qr-title"
        >
          <section className="projector-qr-card">
            <button
              type="button"
              className="projector-qr-close"
              onClick={() => setJoinDialogOpen(false)}
              aria-label="Close join QR code"
            >
              <span aria-hidden="true">×</span>
              Close
            </button>
            <div className="projector-qr-heading">
              <p>Join the live app</p>
              <h1 id="projector-qr-title">Scan to join</h1>
            </div>
            <div className="projector-qr-code">
              <QRCode value={joinUrl} size={512} />
            </div>
            <div className="projector-qr-details">
              <span>Or open the app and use this code</span>
              <code>{slug}</code>
            </div>
          </section>
        </div>
      ) : (
        <button
          type="button"
          className="projector-overlay"
          onClick={() => setJoinDialogOpen(true)}
          aria-label="Show audience QR code"
        >
          <div className="qr-box">
            <QRCode value={joinUrl} size={136} />
          </div>
          <div>
            <strong>Show join QR</strong>
            <code>{slug}</code>
          </div>
        </button>
      )}
      <a className="projector-exit" href="#/gallery">
        Exit projector
      </a>
    </div>
  );
}
