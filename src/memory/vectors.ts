const DIMS = 64;

/** Local hashing embedding. No network and no model download. */
export function embed(text: string): number[] {
  const vector = new Array<number>(DIMS).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 1);
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
    }
    const index = Math.abs(hash) % DIMS;
    vector[index] += (hash & 1) === 0 ? 1 : -1;
  }
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
