import { z } from "zod";

export const themeSchema = z
  .object({
    primary: z.string().optional(),
    secondary: z.string().optional(),
    background: z.string().optional(),
    surface: z.string().optional(),
    text: z.string().optional(),
    accent: z.string().optional(),
    radius: z.string().optional(),
    font: z.string().optional(),
    logoUrl: z.string().optional(),
  })
  .passthrough();

export const collectionGuardsSchema = z
  .object({
    rateLimitPerMin: z.number().int().positive().max(600).optional(),
    monotonicMaxField: z.string().optional(),
    uniqueBy: z.string().optional(),
    maxLen: z.number().int().positive().max(65536).optional(),
    maxItems: z.number().int().positive().max(5000).optional(),
  })
  .passthrough();

export const appSpecSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(2000).default(""),
    projector: z.boolean().optional(),
    theme: themeSchema.optional(),
    collections: z.record(z.string(), collectionGuardsSchema).optional(),
    dataset: z.object({ name: z.string() }).optional(),
    connectorsUsed: z
      .array(z.enum(["convex", "context", "openai", "vercel"]))
      .max(4)
      .optional(),
  })
  .passthrough();

export type AppSpec = z.infer<typeof appSpecSchema>;
export type Theme = z.infer<typeof themeSchema>;

export const DEFAULT_GUARDS = {
  rateLimitPerMin: 30,
  maxLen: 4096,
  maxItems: 5000,
} as const;

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "app";
}
