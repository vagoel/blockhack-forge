export type DevinApiVersion = "v1" | "v3";

/**
 * Legacy v1 exposes session visibility through `unlisted`. Keep generated
 * sessions listed/openable. V3 has no documented visibility request field and
 * inherits the organization's session access policy.
 */
export function devinSessionVisibilityFields(
  apiVersion: DevinApiVersion,
): { unlisted: false } | Record<string, never> {
  return apiVersion === "v1" ? { unlisted: false } : {};
}
