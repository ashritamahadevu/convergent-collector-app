import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { chunkSource, extractSymbols, type CodeChunk, type CodeSymbol } from "./symbols";
import { cosine, embed } from "./vectors";

type StoredChunk = CodeChunk & { vector: number[] };

type RagIndex = {
  repoKey: string;
  updatedAt: number;
  chunks: StoredChunk[];
};

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rs", ".c", ".h", ".cpp",
]);

function repoKey(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "none";
  return folder.replace(/[^a-z0-9]+/gi, "_").slice(-80);
}

function indexPath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "rag-" + repoKey() + ".json");
}

function mapPath(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "repo-map-" + repoKey() + ".json");
}

function readIndex(context: vscode.ExtensionContext): RagIndex {
  try {
    const raw = fs.readFileSync(indexPath(context), "utf8");
    const parsed = JSON.parse(raw) as RagIndex;
    if (parsed && Array.isArray(parsed.chunks)) {
      return parsed;
    }
  } catch {
    // Missing index is the empty index.
  }
  return { repoKey: repoKey(), updatedAt: 0, chunks: [] };
}

function writeIndex(context: vscode.ExtensionContext, index: RagIndex): void {
  fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
  fs.writeFileSync(indexPath(context), JSON.stringify(index));
}

export function deleteCodeIndex(context: vscode.ExtensionContext): void {
  for (const file of [indexPath(context), mapPath(context)]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
}

export function indexFile(context: vscode.ExtensionContext, filePath: string, source: string): number {
  const index = readIndex(context);
  const relative = relativePath(filePath);
  index.chunks = index.chunks.filter((chunk) => chunk.path !== relative);
  for (const chunk of chunkSource(relative, source)) {
    index.chunks.push({ ...chunk, vector: embed(chunk.text) });
  }
  index.updatedAt = Date.now();
  writeIndex(context, index);
  return index.chunks.filter((chunk) => chunk.path === relative).length;
}

export async function indexWorkspace(context: vscode.ExtensionContext): Promise<number> {
  const files = await vscode.workspace.findFiles(
    "**/*.{ts,tsx,js,jsx,py,go,java,rs,c,h,cpp}",
    "**/{node_modules,dist,out,.git}/**",
    200,
  );
  const index: RagIndex = { repoKey: repoKey(), updatedAt: Date.now(), chunks: [] };
  for (const file of files) {
    if (!SOURCE_EXT.has(path.extname(file.fsPath))) {
      continue;
    }
    let source = "";
    try {
      source = fs.readFileSync(file.fsPath, "utf8");
    } catch {
      continue;
    }
    const relative = relativePath(file.fsPath);
    for (const chunk of chunkSource(relative, source)) {
      index.chunks.push({ ...chunk, vector: embed(chunk.text) });
    }
  }
  writeIndex(context, index);
  const symbols: CodeSymbol[] = [];
  for (const file of files) {
    try {
      symbols.push(...extractSymbols(relativePath(file.fsPath), fs.readFileSync(file.fsPath, "utf8")));
    } catch {
      // Skip unreadable files.
    }
  }
  fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
  fs.writeFileSync(mapPath(context), JSON.stringify({ updatedAt: Date.now(), symbols }));
  return index.chunks.length;
}

export function searchCode(context: vscode.ExtensionContext, query: string, limit = 5): CodeChunk[] {
  const vector = embed(query);
  return readIndex(context).chunks
    .map((chunk) => ({ chunk, score: cosine(vector, chunk.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => ({
      path: chunk.path,
      name: chunk.name,
      startLine: chunk.startLine,
      text: chunk.text,
    }));
}

function relativePath(filePath: string): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder && filePath.startsWith(folder)) {
    return path.relative(folder, filePath).replace(/\\/g, "/");
  }
  return filePath.replace(/\\/g, "/");
}
