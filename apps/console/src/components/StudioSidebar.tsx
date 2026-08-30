import { useQuery } from "convex/react";
import type { CompileWorkerStatus } from "../compileWorker";
import { api, SHELL_URL } from "../convexClient";
import { useOperatorKey } from "../operator";

type ActiveView = "build" | "gallery" | "recent";

type RecentApp = {
  _id: string;
  slug: string;
  name: string;
  status: string;
  productionUrl?: string;
};

const NAV_ITEMS: Array<{
  view: ActiveView;
  label: string;
  detail: string;
  href: string;
  glyph: string;
}> = [
  { view: "build", label: "New app", detail: "Start creating", href: "#/build", glyph: "+" },
  { view: "gallery", label: "Projects", detail: "Apps & stage", href: "#/gallery", glyph: "▦" },
  { view: "recent", label: "Activity", detail: "Build history", href: "#/recent", glyph: "↗" },
];

export default function StudioSidebar({
  active,
  worker,
}: {
  active: ActiveView;
  worker: CompileWorkerStatus;
}) {
  const operatorKey = useOperatorKey();
  const apps = useQuery(api.apps.list, { operatorKey }) as RecentApp[] | undefined;

  return (
    <aside className="studio-sidebar">
      <a className="studio-brand" href="#/build" aria-label="Builder home">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>
          <strong>Builder</strong>
          <small>Live app studio</small>
        </span>
      </a>

      <nav className="studio-nav" aria-label="Studio navigation">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.view}
            className={`studio-nav-item${active === item.view ? " is-active" : ""}`}
            href={item.href}
          >
            <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </a>
        ))}
        <a
          className="studio-nav-item"
          href={`${SHELL_URL}/#/stage`}
          target="_blank"
          rel="noreferrer"
        >
          <span className="nav-glyph nav-glyph-live" aria-hidden="true">●</span>
          <span>
            <strong>Stage</strong>
            <small>Open live view</small>
          </span>
        </a>
      </nav>

      <div className="sidebar-recents">
        <div className="sidebar-section-label">
          <span>Recent projects</span>
          <a href="#/gallery">View all</a>
        </div>
        {apps === undefined ? (
          <div className="sidebar-skeleton" aria-label="Loading recent projects" />
        ) : apps.length === 0 ? (
          <p className="sidebar-empty">Your latest apps will appear here.</p>
        ) : (
          <div className="recent-project-list">
            {apps.slice(0, 4).map((app) => (
              <a
                className="recent-project"
                href={app.productionUrl ?? `${SHELL_URL}/#/${app.slug}`}
                target="_blank"
                rel="noreferrer"
                key={app._id}
                title={`Open ${app.name}`}
              >
                <span className={`project-status project-status-${app.status}`} />
                <span>{app.name}</span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="system-status">
          <span className={`system-dot${worker.state === "compiling" ? " is-busy" : ""}`} />
          <span>
            <strong>{worker.state === "compiling" ? "Publishing" : "Systems ready"}</strong>
            <small>
              {worker.pending > 0
                ? `${worker.pending} build${worker.pending === 1 ? "" : "s"} queued`
                : worker.lastError
                  ? "Needs attention"
                  : "Realtime compiler online"}
            </small>
          </span>
        </div>
      </div>
    </aside>
  );
}
