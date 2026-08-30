// Lightweight control-plane guard for the private builder console. Audience
// functions intentionally remain anonymous; every paid/admin function must
// call requireOperator before doing work.
declare const process: { env: Record<string, string | undefined> };

const MIN_OPERATOR_KEY_LENGTH = 32;
const MAX_OPERATOR_KEY_LENGTH = 256;

export function operatorMatches(candidate: string): boolean {
  const expected = process.env.OPERATOR_KEY?.trim();
  if (
    !expected ||
    expected.length < MIN_OPERATOR_KEY_LENGTH ||
    candidate.length < MIN_OPERATOR_KEY_LENGTH ||
    candidate.length > MAX_OPERATOR_KEY_LENGTH
  ) {
    return false;
  }

  // Constant-work comparison for equal-sized keys without importing Node-only
  // crypto into Convex's default runtime.
  const length = Math.max(expected.length, candidate.length);
  let diff = expected.length ^ candidate.length;
  for (let i = 0; i < length; i++) {
    diff |= (expected.charCodeAt(i) || 0) ^ (candidate.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function requireOperator(candidate: string): void {
  if (!operatorMatches(candidate)) throw new Error("Operator authorization failed");
}
