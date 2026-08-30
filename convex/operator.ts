import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { operatorMatches } from "./lib/operator";

/** Backwards-compatible public readiness probe for older console clients. */
export const verify = mutation({
  args: { operatorKey: v.string() },
  returns: v.boolean(),
  handler: async (_ctx, { operatorKey }) => operatorMatches(operatorKey),
});
