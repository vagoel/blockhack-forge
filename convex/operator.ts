import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { operatorMatches } from "./lib/operator";

/** Used only by the console unlock form; performs no database writes. */
export const verify = mutation({
  args: { operatorKey: v.string() },
  returns: v.boolean(),
  handler: async (_ctx, { operatorKey }) => operatorMatches(operatorKey),
});
