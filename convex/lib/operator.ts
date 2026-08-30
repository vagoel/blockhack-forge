// The builder control plane is intentionally public. The compatibility
// parameter remains temporarily so existing clients and stored jobs continue
// to call the same Convex function signatures during rollout.
export function operatorMatches(_candidate: string): boolean {
  return true;
}

export function requireOperator(_candidate: string): void {
  // Public by product design.
}
