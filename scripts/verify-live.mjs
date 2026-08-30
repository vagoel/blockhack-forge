import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function envValue(file, name) {
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is missing from ${file}`);
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

function withTimeout(promise, label, timeoutMs = 8_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function watchForPresence(client, roomToken, userId) {
  let unsubscribe = () => {};
  const startedAt = performance.now();
  const promise = new Promise((resolve, reject) => {
    unsubscribe = client.onUpdate(
      anyApi.presence.list,
      { roomToken },
      (people) => {
        if (people.some((person) => person?.userId === userId && person?.online)) {
          resolve(Math.round(performance.now() - startedAt));
        }
      },
      reject,
    );
  });
  return { promise, unsubscribe: () => unsubscribe() };
}

const slug = process.argv[2];
if (!slug) {
  throw new Error("Usage: pnpm verify:live <app-slug>");
}

const deploymentUrl = envValue(
  path.join(root, "apps/console/.env.local"),
  "VITE_CONVEX_URL",
);
const http = new ConvexHttpClient(deploymentUrl);
const appResult = await http.query(anyApi.apps.getBySlug, { slug });
if (!appResult?.app?._id) throw new Error(`Live app not found: ${slug}`);

const appId = appResult.app._id;
const runId = Date.now().toString(36);
const userA = `verify-a-${runId}`;
const userB = `verify-b-${runId}`;

const clientA = new ConvexClient(deploymentUrl);
const clientB = new ConvexClient(deploymentUrl);
let sessionTokenA;
let sessionTokenB;

try {
  const firstPresence = await clientA.mutation(anyApi.presence.heartbeat, {
    appId,
    roomId: slug,
    userId: userA,
    sessionId: `presence-a-${runId}`,
    interval: 10_000,
  });
  sessionTokenA = firstPresence.sessionToken;
  const seenOnA = watchForPresence(clientA, firstPresence.roomToken, userB);
  const seenOnB = watchForPresence(clientB, firstPresence.roomToken, userB);
  const secondPresence = await clientB.mutation(anyApi.presence.heartbeat, {
    appId,
    roomId: slug,
    userId: userB,
    sessionId: `presence-b-${runId}`,
    interval: 10_000,
  });
  sessionTokenB = secondPresence.sessionToken;
  const [presenceMsA, presenceMsB] = await withTimeout(
    Promise.all([seenOnA.promise, seenOnB.promise]),
    "two-client realtime presence",
  );
  seenOnA.unsubscribe();
  seenOnB.unsubscribe();

  // Exercise a declared guard with a guaranteed rejection, so verification
  // never leaves synthetic game data in the generated app.
  const collections = Object.entries(appResult.app.spec?.collections ?? {});
  const monotonic = collections.find(([, guards]) =>
    guards && typeof guards === "object" && typeof guards.monotonicMaxField === "string"
  );
  const bounded = collections.find(([, guards]) =>
    guards && typeof guards === "object" && Number.isFinite(guards.maxLen)
  );
  let guardCheck = { collection: null, reason: "not_declared" };
  if (monotonic) {
    const [collection, guards] = monotonic;
    const rejected = await clientA.mutation(anyApi.runtime.pushItem, {
      appId,
      collection,
      data: { [guards.monotonicMaxField]: "invalid-number" },
      sessionId: userA,
    });
    if (rejected?.ok || rejected?.reason !== "not_monotonic") {
      throw new Error(`Monotonic guard failed: ${JSON.stringify(rejected)}`);
    }
    guardCheck = { collection, reason: rejected.reason };
  } else if (bounded) {
    const [collection, guards] = bounded;
    const rejected = await clientA.mutation(anyApi.runtime.pushItem, {
      appId,
      collection,
      data: { verifierPayload: "x".repeat(Math.max(1_024, guards.maxLen + 64)) },
      sessionId: userA,
    });
    if (rejected?.ok || rejected?.reason !== "too_large") {
      throw new Error(`Size guard failed: ${JSON.stringify(rejected)}`);
    }
    guardCheck = { collection, reason: rejected.reason };
  }

  console.log(
    JSON.stringify(
      {
        slug,
        appStatus: appResult.app.status,
        guardCheck,
        realtimePresenceMs: { clientA: presenceMsA, clientB: presenceMsB },
      },
      null,
      2,
    ),
  );
} finally {
  if (sessionTokenA) {
    await clientA.mutation(anyApi.presence.disconnect, { sessionToken: sessionTokenA }).catch(() => {});
  }
  if (sessionTokenB) {
    await clientB.mutation(anyApi.presence.disconnect, { sessionToken: sessionTokenB }).catch(() => {});
  }
  await Promise.allSettled([clientA.close(), clientB.close()]);
}
