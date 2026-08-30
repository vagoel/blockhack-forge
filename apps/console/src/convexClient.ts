import { ConvexReactClient } from "convex/react";
import { anyApi } from "convex/server";

export const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL as string,
);

// convex/_generated does not exist in this workspace; anyApi keeps the console
// decoupled from backend codegen. Cast once so call sites stay clean.
export const api = anyApi as any;

export const SHELL_URL: string = (
  (import.meta.env.VITE_SHELL_URL as string | undefined) ??
  "http://localhost:5174"
).replace(/\/+$/, "");
