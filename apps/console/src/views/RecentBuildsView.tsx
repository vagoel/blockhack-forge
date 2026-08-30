import { useQuery } from "convex/react";
import { connectorMark } from "../connectors";
import { api } from "../convexClient";
import { useOperatorKey } from "../operator";

type BuildRow = {
  _id: string;
  prompt: string;
  status: string;
  appSlug?: string;
  createdAt: number;
  connectors?: string[];
  deploymentStatus?: string;
  productionUrl?: string;
};

function dayGroup(timestamp: number): "Today" | "Yesterday" | "Earlier" {
  const now = new Date();
  const value = new Date(timestamp);
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startValue = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startNow - startValue) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return "Earlier";
}

function statusCopy(status: string): string {
  switch (status) {
    case "live": return "Published and ready to share";
    case "queued": return "Queued for generation";
    case "grounding": return "Gathering brand and web context";
    case "generating": return "Devin is creating the app";
    case "awaiting_compile": return "Generated source is compiling";
    case "deploying": return "Publishing the production deployment";
    case "error": return "Build needs attention";
    default: return status.replace(/_/g, " ");
  }
}

export default function RecentBuildsView() {
  const operatorKey = useOperatorKey();
  const builds = useQuery(api.builds.listRecent, { operatorKey }) as BuildRow[] | undefined;

  const groups = builds
    ? (["Today", "Yesterday", "Earlier"] as const)
        .map((label) => ({ label, builds: builds.filter((build) => dayGroup(build.createdAt) === label) }))
        .filter((group) => group.builds.length > 0)
    : [];

  return (
    <section className="activity-page">
      <header className="page-header">
        <div>
          <span className="section-kicker">Realtime pipeline</span>
          <h1>Activity</h1>
          <p>Follow every generation, compile, and deployment from one place.</p>
        </div>
        <a className="btn btn-primary" href="#/build">New app <span aria-hidden="true">+</span></a>
      </header>

      {builds === undefined ? (
        <div className="activity-skeleton" aria-label="Loading build activity">
          {[0, 1, 2].map((item) => <div key={item} />)}
        </div>
      ) : builds.length === 0 ? (
        <div className="page-state activity-empty">
          <span className="state-glyph">↗</span>
          <h2>No build activity yet</h2>
          <p>Your generation and deployment timeline will show up here.</p>
          <a className="btn btn-primary" href="#/build">Create your first app</a>
        </div>
      ) : (
        <div className="activity-groups">
          {groups.map((group) => (
            <section className="activity-group" key={group.label}>
              <div className="activity-group-label">
                <h2>{group.label}</h2>
                <span>{group.builds.length}</span>
              </div>
              <div className="activity-list">
                {group.builds.map((build) => (
                  <a className="activity-row" href={`#/build/${build._id}`} key={build._id}>
                    <span className={`activity-icon activity-icon-${build.status}`} aria-hidden="true">
                      {build.status === "live" ? "✓" : build.status === "error" ? "!" : "↗"}
                    </span>
                    <span className="activity-copy">
                      <strong>{build.prompt}</strong>
                      <span>
                        {build.status === "live" && build.deploymentStatus && build.deploymentStatus !== "ready"
                          ? build.deploymentStatus === "error"
                            ? "Live link ready; Vercel deployment needs attention"
                            : "Publishing the production deployment"
                          : statusCopy(build.status)}
                      </span>
                    </span>
                    {build.connectors?.length ? (
                      <span className="activity-connectors">
                        {build.connectors.slice(0, 3).map((connector) => (
                          <i key={connector}>{connectorMark(connector)}</i>
                        ))}
                      </span>
                    ) : null}
                    {build.appSlug ? <code>{build.appSlug}</code> : null}
                    <span className="activity-time">
                      {new Date(build.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`badge badge-${build.status}`}>{build.status.replace(/_/g, " ")}</span>
                    <span className="activity-arrow" aria-hidden="true">→</span>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
