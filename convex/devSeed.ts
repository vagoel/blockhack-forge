// TEMPORARY dev-only seeding: pushes a hand-written app through the real
// publish -> compile -> render pipeline without spending a Devin session.
// Run: npx convex run devSeed:seedTapRace
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const TSX = `
import { useState } from "react";
import * as Runtime from "@runtime/sdk";
import { Screen, Card, BigButton, Leaderboard, PresencePill, Stat } from "@runtime/ui";

export default function App() {
  const me = Runtime.useMe();
  const rt = Runtime.useRt();
  const board = Runtime.useLeaderboard(10);
  const people = Runtime.usePresence();
  const mode = Runtime.useMode();
  const [taps, setTaps] = useState(0);

  const tap = async () => {
    setTaps((t) => t + 1);
    await rt.addScore(me.name, 1);
  };

  if (mode === "projector") {
    return (
      <Screen title="Tap Race">
        <PresencePill count={people.filter((p) => p.online).length} />
        <Leaderboard entries={board.map((e) => ({ name: e.name, points: e.points }))} />
      </Screen>
    );
  }

  return (
    <Screen title="Tap Race">
      <Card>
        <Stat label="Your taps this session" value={String(taps)} />
        <BigButton onClick={tap}>TAP!</BigButton>
      </Card>
      <Card title="Leaderboard">
        <Leaderboard
          entries={board.map((e) => ({
            name: e.name,
            points: e.points,
            highlight: e.sessionId === me.sessionId,
          }))}
        />
      </Card>
      <PresencePill count={people.filter((p) => p.online).length} />
    </Screen>
  );
}
`.trim();

const SPEC = {
  name: "Tap Race",
  description: "Tap as fast as you can; live leaderboard.",
  projector: true,
  collections: {},
};

export const seedTapRace = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const buildId = await ctx.db.insert("builds", {
      prompt: "dev seed: tap race",
      status: "awaiting_compile",
      createdAt: Date.now(),
    });
    let slug = "tap-race";
    const hit = await ctx.db
      .query("apps")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (hit) slug = `tap-race-${Date.now().toString(36)}`;
    const appId = await ctx.db.insert("apps", {
      slug,
      name: SPEC.name,
      prompt: "dev seed: tap race",
      status: "awaiting_compile",
      spec: SPEC,
      createdAt: Date.now(),
    });
    await ctx.db.patch(buildId, { appId, appSlug: slug });
    await ctx.db.insert("appVersions", {
      appId,
      buildId,
      version: 1,
      tsxSource: TSX,
      specJson: SPEC,
      status: "awaiting_compile",
      createdAt: Date.now(),
    });
    return slug;
  },
});
