import { type CSSProperties } from "react";
import { CONNECTORS, type ConnectorId } from "../connectors";

export type ConnectorReadiness = Record<ConnectorId, boolean>;

type ConnectorRailProps = {
  selected: ReadonlySet<ConnectorId>;
  readiness: ConnectorReadiness | undefined;
  onToggle: (id: ConnectorId) => void;
};

export default function ConnectorRail({ selected, readiness, onToggle }: ConnectorRailProps) {
  return (
    <aside className="connector-rail" aria-labelledby="connector-heading">
      <div className="connector-rail-head">
        <div>
          <span className="section-kicker">Capabilities</span>
          <h2 id="connector-heading">Power this build</h2>
        </div>
        <span className="connector-count">{selected.size} on</span>
      </div>
      <p className="connector-intro">
        Only selected services are available to generation and runtime.
      </p>

      <div className="connector-list">
        {CONNECTORS.map((connector) => {
          const enabled = selected.has(connector.id);
          const ready = readiness?.[connector.id];
          return (
            <button
              className={`connector-card${enabled ? " is-enabled" : ""}${ready === false ? " is-missing" : ""}`}
              key={connector.id}
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`${connector.name}: ${enabled ? "enabled" : "disabled"}`}
              disabled={connector.pinned || ready === false}
              onClick={() => onToggle(connector.id)}
              style={{ "--connector-color": connector.color } as CSSProperties}
            >
              <span className="connector-mark" aria-hidden="true">
                {connector.monogram}
              </span>
              <span className="connector-copy">
                <span className="connector-title-row">
                  <strong>{connector.name}</strong>
                  <span className="connector-eyebrow">{connector.eyebrow}</span>
                </span>
                <span>{connector.description}</span>
                {ready === false ? (
                  <small className="connector-missing">Credential not configured</small>
                ) : readiness === undefined ? (
                  <small className="connector-checking">Checking availability…</small>
                ) : connector.pinned ? (
                  <small>Always published</small>
                ) : enabled ? (
                  <small>Enabled for this build</small>
                ) : null}
              </span>
              <span className="switch-control" aria-hidden="true">
                <span />
              </span>
            </button>
          );
        })}
      </div>

      <div className="connector-footnote">
        <span className="privacy-mark" aria-hidden="true">◆</span>
        <p>
          Credentials stay server-side. Generated apps only receive the capabilities
          you enable.
        </p>
      </div>
    </aside>
  );
}
