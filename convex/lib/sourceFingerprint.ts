/**
 * Small deterministic source fingerprint usable in both Convex and Node
 * runtimes. This is an idempotency marker, not a security primitive.
 */
export function sourceFingerprint(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${source.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
