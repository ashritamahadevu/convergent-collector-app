export type CodeSymbol = {
  path: string;
  name: string;
  kind: "function" | "class" | "method";
  line: number;
  signature: string;
};

const PATTERNS: { kind: CodeSymbol["kind"]; re: RegExp }[] = [
  { kind: "class", re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/ },
  { kind: "function", re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: "function", re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][\w]*)\s*=>/ },
  { kind: "function", re: /^\s*def\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: "class", re: /^\s*class\s+([A-Za-z_][\w]*)\s*[:(]/ },
  { kind: "method", re: /^\s*(?:public|private|protected|static|async|\s)*\s+([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{/ },
  { kind: "function", re: /^\s*func\s+([A-Za-z_][\w]*)\s*\(/ },
  { kind: "function", re: /^\s*fn\s+([A-Za-z_][\w]*)\s*\(/ },
];

/** Symbol boundaries for a repo map. Language-agnostic patterns, not a native parser. */
export function extractSymbols(path: string, source: string): CodeSymbol[] {
  const lines = source.split(/\r?\n/);
  const found: CodeSymbol[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 240) {
      continue;
    }
    for (const pattern of PATTERNS) {
      const match = pattern.re.exec(line);
      if (!match) {
        continue;
      }
      const name = match[1];
      const key = pattern.kind + ":" + name + ":" + (i + 1);
      if (seen.has(key)) {
        break;
      }
      seen.add(key);
      found.push({
        path,
        name,
        kind: pattern.kind,
        line: i + 1,
        signature: line.trim().slice(0, 180),
      });
      break;
    }
  }
  return found;
}

export type CodeChunk = {
  path: string;
  name: string;
  startLine: number;
  text: string;
};

/** Split a file into function-sized chunks, falling back to a window of lines. */
export function chunkSource(path: string, source: string): CodeChunk[] {
  const symbols = extractSymbols(path, source).filter((s) => s.kind !== "class");
  const lines = source.split(/\r?\n/);
  if (symbols.length === 0) {
    return [{
      path,
      name: path,
      startLine: 1,
      text: lines.slice(0, 80).join("\n"),
    }];
  }
  const chunks: CodeChunk[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const start = symbols[i].line - 1;
    const end = i + 1 < symbols.length ? symbols[i + 1].line - 1 : Math.min(lines.length, start + 80);
    chunks.push({
      path,
      name: symbols[i].name,
      startLine: symbols[i].line,
      text: lines.slice(start, end).join("\n").slice(0, 4000),
    });
  }
  return chunks;
}
