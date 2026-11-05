import { normPath } from "./agentProtocol";

/**
 * Last text we treated as already accepted for an open file.
 * The disk fallback diffs against this so an agent edit can be reverted
 * without a hook snapshot.
 */
const accepted = new Map<string, string>();

export function noteAccepted(fsPath: string, text: string): void {
  accepted.set(normPath(fsPath), text);
}

export function acceptedText(fsPath: string): string | undefined {
  return accepted.get(normPath(fsPath));
}

export function resetBaselines(): void {
  accepted.clear();
}
