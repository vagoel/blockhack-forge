/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as apps from "../apps.js";
import type * as builds from "../builds.js";
import type * as connectors from "../connectors.js";
import type * as contextdev from "../contextdev.js";
import type * as crons from "../crons.js";
import type * as devSeed from "../devSeed.js";
import type * as devin from "../devin.js";
import type * as devinActions from "../devinActions.js";
import type * as lib_appSpec from "../lib/appSpec.js";
import type * as lib_connectors from "../lib/connectors.js";
import type * as lib_devinMode from "../lib/devinMode.js";
import type * as lib_operator from "../lib/operator.js";
import type * as lib_runtimeAsset from "../lib/runtimeAsset.js";
import type * as lib_skillMatch from "../lib/skillMatch.js";
import type * as lib_skillsData from "../lib/skillsData.js";
import type * as lib_sourceFingerprint from "../lib/sourceFingerprint.js";
import type * as operator from "../operator.js";
import type * as presence from "../presence.js";
import type * as runtime from "../runtime.js";
import type * as vercel from "../vercel.js";
import type * as vercelData from "../vercelData.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  apps: typeof apps;
  builds: typeof builds;
  connectors: typeof connectors;
  contextdev: typeof contextdev;
  crons: typeof crons;
  devSeed: typeof devSeed;
  devin: typeof devin;
  devinActions: typeof devinActions;
  "lib/appSpec": typeof lib_appSpec;
  "lib/connectors": typeof lib_connectors;
  "lib/devinMode": typeof lib_devinMode;
  "lib/operator": typeof lib_operator;
  "lib/runtimeAsset": typeof lib_runtimeAsset;
  "lib/skillMatch": typeof lib_skillMatch;
  "lib/skillsData": typeof lib_skillsData;
  "lib/sourceFingerprint": typeof lib_sourceFingerprint;
  operator: typeof operator;
  presence: typeof presence;
  runtime: typeof runtime;
  vercel: typeof vercel;
  vercelData: typeof vercelData;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
