import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOperator } from "./lib/operator";

declare const process: { env: Record<string, string | undefined> };

function present(...values: Array<string | undefined>): boolean {
  return values.some((value) => Boolean(value?.trim()));
}

/** Credential readiness only. Secret values never leave the backend. */
export const status = query({
  args: { operatorKey: v.string() },
  returns: v.object({
    convex: v.boolean(),
    context: v.boolean(),
    openai: v.boolean(),
    vercel: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    requireOperator(args.operatorKey);
    return {
      convex: true,
      context: present(process.env.CONTEXT_DEV_API_KEY, process.env.CONTEXT),
      openai: present(process.env.OPENAI_API_KEY, process.env.OPENAI_KEY),
      vercel: present(process.env.VERCEL_TOKEN, process.env.VERCEL),
    };
  },
});
