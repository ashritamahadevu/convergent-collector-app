/** Inserted text for one document, added up over a short window. */
export type WindowTotal = { text: string; chars: number };

export class InsertWindow {
  private buckets = new Map<string, { text: string; chars: number; at: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  add(key: string, text: string): WindowTotal {
    const at = this.now();
    const prev = this.buckets.get(key);
    const fresh = prev && at - prev.at <= this.windowMs
      ? prev
      : { text: "", chars: 0, at };
    fresh.text += text;
    fresh.chars += text.length;
    fresh.at = at;
    this.buckets.set(key, fresh);
    return { text: fresh.text, chars: fresh.chars };
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }
}

/**
 * Ranges of inserted text after every change in one event has been applied.
 * Offsets are positions in the document as it is now.
 */
export function insertedSpans(
  changes: { rangeOffset: number; rangeLength: number; text: string }[],
): { start: number; end: number; text: string }[] {
  let shift = 0;
  const spans: { start: number; end: number; text: string }[] = [];
  for (const change of changes) {
    const start = change.rangeOffset + shift;
    if (change.text.length > 0) {
      spans.push({ start, end: start + change.text.length, text: change.text });
    }
    shift += change.text.length - change.rangeLength;
  }
  return spans;
}
