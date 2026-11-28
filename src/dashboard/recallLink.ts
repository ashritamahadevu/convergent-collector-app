/** Desktop opens this URI. The extension starts the existing recall quiz. */

const topicPattern = /^[^\u0000-\u001f]{1,200}$/;

export function parseRecallTopic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const topic = value.trim();
  return topicPattern.test(topic) ? topic : null;
}

export function recallUri(topic: string, scheme: "cursor" | "vscode"): string {
  const safe = parseRecallTopic(topic);
  if (!safe) throw new Error("Invalid recall topic");
  return scheme + "://comprehension-guard.comprehension-guard/recall?topic=" + encodeURIComponent(safe);
}
