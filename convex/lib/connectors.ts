import { v } from "convex/values";

export const CONNECTOR_IDS = ["convex", "context", "openai", "vercel"] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export const connectorValidator = v.union(
  v.literal("convex"),
  v.literal("context"),
  v.literal("openai"),
  v.literal("vercel")
);
export const connectorsValidator = v.array(connectorValidator);

/**
 * Builds created before connector permissions existed were generated against
 * the realtime SDK. Preserve that behavior for those rows without granting
 * any of the newer paid capabilities.
 */
export const LEGACY_APP_CONNECTORS: readonly ConnectorId[] = ["convex"];

export function normalizeConnectors(values: readonly ConnectorId[]): ConnectorId[] {
  const selected = new Set(values);
  return CONNECTOR_IDS.filter((id) => selected.has(id));
}

export function appConnectors(app: { connectors?: ConnectorId[] }): readonly ConnectorId[] {
  return app.connectors ?? LEGACY_APP_CONNECTORS;
}

export function hasAppConnector(
  app: { connectors?: ConnectorId[] },
  connector: ConnectorId
): boolean {
  return appConnectors(app).includes(connector);
}
