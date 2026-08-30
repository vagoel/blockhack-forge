import { v } from "convex/values";

export const providerDevinModeValidator = v.union(
  v.literal("normal"),
  v.literal("fast"),
  v.literal("lite"),
  v.literal("ultra"),
  v.literal("fusion"),
);
export const devinModeValidator = v.union(
  v.literal("default"),
  v.literal("normal"),
  v.literal("fast"),
  v.literal("lite"),
  v.literal("ultra"),
  v.literal("fusion"),
);

export type ProviderDevinMode = "normal" | "fast" | "lite" | "ultra" | "fusion";
export type DevinMode = "default" | ProviderDevinMode;

export const providerDevinModes: readonly ProviderDevinMode[] = [
  "normal",
  "fast",
  "lite",
  "ultra",
  "fusion",
];

export function isProviderDevinMode(value: unknown): value is ProviderDevinMode {
  return providerDevinModes.some((mode) => mode === value);
}

export function normalizeDevinMode(value: unknown): DevinMode {
  return value === "default" || isProviderDevinMode(value) ? value : "default";
}

export function devinModeLabel(mode: DevinMode): string {
  switch (mode) {
    case "normal":
      return "Devin Agent";
    case "fast":
      return "Devin Fast";
    case "lite":
      return "Devin Lite";
    case "ultra":
      return "Devin Ultra";
    case "fusion":
      return "Devin Fusion";
    default:
      return "Devin organization default";
  }
}

export function devinModeRequestFields(
  apiVersion: "v1" | "v3",
  mode: DevinMode,
): Record<string, never> | { devin_mode: ProviderDevinMode } {
  if (apiVersion === "v1") {
    if (mode !== "default") {
      throw new Error(`${devinModeLabel(mode)} requires Devin API v3`);
    }
    return {};
  }
  return mode === "default" ? {} : { devin_mode: mode };
}
