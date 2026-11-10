const SWAPS: [string, string][] = [
  ["===", "!=="],
  ["!==", "==="],
  ["<=", "<"],
  [">=", ">"],
  ["<", "<="],
  [">", ">="],
];

/** One-token behavior change used when the model cannot produce a distinct bug. */
export function plantFallbackBug(source: string): string | undefined {
  for (const [from, to] of SWAPS) {
    const index = source.indexOf(from);
    if (index >= 0) {
      return source.slice(0, index) + to + source.slice(index + from.length);
    }
  }
  return undefined;
}

export function sameCode(actual: string, expected: string): boolean {
  return actual.replace(/\s+$/g, "") === expected.replace(/\s+$/g, "");
}
