export const MAX_AUTOMATIC_COMPILE_REPAIRS = 1;

export function shouldAutomaticallyRepairCompile(
  attempts: number | undefined,
  hasDevinSession: boolean,
): boolean {
  return hasDevinSession && (attempts ?? 0) < MAX_AUTOMATIC_COMPILE_REPAIRS;
}

export function compileRepairPrompt(error: string): string {
  const diagnostic = error.replace(/\s+/g, " ").trim().slice(0, 1_200);
  return [
    "The builder rejected the generated TSX during its automated compile preflight.",
    `Compiler diagnostic: ${diagnostic || "unknown compile error"}`,
    "Correct the TSX so it satisfies the source contract, while preserving the requested product and design.",
    "Treat ordinary local variables, component props, and data-field vocabulary as normal app concepts; never use actual browser globals, DOM escape hatches, navigation, or network APIs.",
    "Return the complete structured output again with the full corrected appTsx. Do not ask the user to diagnose or repair this compiler issue.",
  ].join("\n");
}
