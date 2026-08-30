export const CONNECTOR_IDS = ["convex", "context", "openai", "vercel"] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export type ConnectorDefinition = {
  id: ConnectorId;
  name: string;
  eyebrow: string;
  description: string;
  color: string;
  monogram: string;
  pinned?: boolean;
};

export const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: "convex",
    name: "Convex",
    eyebrow: "Realtime",
    description: "Presence, shared state, scores, and timers.",
    color: "#ef6351",
    monogram: "CX",
  },
  {
    id: "context",
    name: "Context",
    eyebrow: "Grounding",
    description: "Brand styling, URL data, and grounded docs.",
    color: "#159b88",
    monogram: "CT",
  },
  {
    id: "openai",
    name: "Intelligence",
    eyebrow: "AI",
    description: "Optional intelligent generation inside the finished app.",
    color: "#7567e8",
    monogram: "AI",
  },
  {
    id: "vercel",
    name: "Vercel",
    eyebrow: "Delivery",
    description: "A public production deployment for every app.",
    color: "#171922",
    monogram: "▲",
    pinned: true,
  },
] as const;

export const DEFAULT_CONNECTORS: ConnectorId[] = ["vercel"];

export function orderedConnectors(selected: ReadonlySet<ConnectorId>): ConnectorId[] {
  return CONNECTOR_IDS.filter((id) => selected.has(id));
}

export function connectorLabel(id: string): string {
  return CONNECTORS.find((connector) => connector.id === id)?.name ?? id;
}

export function connectorMark(id: string): string {
  return CONNECTORS.find((connector) => connector.id === id)?.monogram ?? id.charAt(0).toUpperCase();
}
