import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { Presence } from "@convex-dev/presence";
import { hasAppConnector } from "./lib/connectors";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
    appId: v.optional(v.id("apps")),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { roomId, userId, sessionId, interval, appId }) => {
    const app = appId
      ? await ctx.db.get(appId)
      : await ctx.db
          .query("apps")
          .withIndex("by_slug", (q) => q.eq("slug", roomId))
          .first();
    if (!app || app.slug !== roomId) throw new Error("Unknown presence room");

    // Current generated runtimes identify their app explicitly and are always
    // connector-gated. Calls without appId are retained for the platform's
    // pre-live waiting room and old runtimes; once an app is live, those calls
    // are allowed only for legacy/Convex-enabled apps.
    if ((appId !== undefined || app.status === "live") && !hasAppConnector(app, "convex")) {
      throw new Error("Convex realtime is not enabled for this app");
    }
    return await presence.heartbeat(ctx, roomId, userId, sessionId, interval);
  },
});

export const list = query({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(v.any()),
    })
  ),
  handler: async (ctx, { roomToken }) => {
    return await presence.list(ctx, roomToken);
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    return await presence.disconnect(ctx, sessionToken);
  },
});
