const recent = new Map<string, number>();
const KEEP_MS = 60_000;

/** Remember a snippet that just passed, so an immediate redo is not quizzed again. */
export function rememberAcceptedSnippet(text: string): void {
  if (!text) {
    return;
  }
  const now = Date.now();
  recent.set(text, now + KEEP_MS);
  for (const [key, until] of recent) {
    if (until <= now) {
      recent.delete(key);
    }
  }
}

export function wasJustAccepted(text: string): boolean {
  const until = recent.get(text);
  return until !== undefined && until > Date.now();
}

export function resetAcceptedSnippets(): void {
  recent.clear();
}
