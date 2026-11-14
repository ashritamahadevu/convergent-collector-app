import { createRequire } from "node:module";
import path from "node:path";
import type { Language as TreeSitterLanguage, Node } from "web-tree-sitter";

const require = createRequire(__filename);
const { Parser, Language } = require("web-tree-sitter") as typeof import("web-tree-sitter");

export { Parser, Language };

type LanguageSpec = { language: string; wasm: string };

const EXTENSIONS: Record<string, LanguageSpec> = {
  ".js": { language: "javascript", wasm: "tree-sitter-javascript.wasm" },
  ".mjs": { language: "javascript", wasm: "tree-sitter-javascript.wasm" },
  ".cjs": { language: "javascript", wasm: "tree-sitter-javascript.wasm" },
  ".jsx": { language: "tsx", wasm: "tree-sitter-tsx.wasm" },
  ".ts": { language: "typescript", wasm: "tree-sitter-typescript.wasm" },
  ".tsx": { language: "tsx", wasm: "tree-sitter-tsx.wasm" },
  ".py": { language: "python", wasm: "tree-sitter-python.wasm" },
  ".c": { language: "c", wasm: "tree-sitter-c.wasm" },
  ".h": { language: "c", wasm: "tree-sitter-c.wasm" },
  ".cc": { language: "cpp", wasm: "tree-sitter-cpp.wasm" },
  ".cpp": { language: "cpp", wasm: "tree-sitter-cpp.wasm" },
  ".cxx": { language: "cpp", wasm: "tree-sitter-cpp.wasm" },
  ".hpp": { language: "cpp", wasm: "tree-sitter-cpp.wasm" },
  ".hh": { language: "cpp", wasm: "tree-sitter-cpp.wasm" },
  ".go": { language: "go", wasm: "tree-sitter-go.wasm" },
  ".rs": { language: "rust", wasm: "tree-sitter-rust.wasm" },
  ".java": { language: "java", wasm: "tree-sitter-java.wasm" },
  ".cs": { language: "csharp", wasm: "tree-sitter-c_sharp.wasm" },
  ".rb": { language: "ruby", wasm: "tree-sitter-ruby.wasm" },
  ".php": { language: "php", wasm: "tree-sitter-php.wasm" },
  ".kt": { language: "kotlin", wasm: "tree-sitter-kotlin.wasm" },
  ".swift": { language: "swift", wasm: "tree-sitter-swift.wasm" },
  ".lua": { language: "lua", wasm: "tree-sitter-lua.wasm" },
  ".sh": { language: "bash", wasm: "tree-sitter-bash.wasm" },
  ".bash": { language: "bash", wasm: "tree-sitter-bash.wasm" },
};

const languageCache = new Map<string, TreeSitterLanguage>();
let initPromise: Promise<boolean> | null = null;
let wasmDirectory: string | null = null;

function wasmDir(): string {
  if (!wasmDirectory) {
    wasmDirectory = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
  }
  return wasmDirectory;
}

function extensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

function ensureInit(): Promise<boolean> {
  if (!initPromise) {
    const init = Parser.init as (options?: {
      locateFile?: (file: string, scriptDirectory: string) => string;
    }) => Promise<void>;
    initPromise = (async () => {
      try {
        // package.json is not an exported subpath; the wasm file is.
        const wasm = require.resolve("web-tree-sitter/tree-sitter.wasm");
        const dir = path.dirname(wasm);
        await init({
          locateFile(file) {
            return file === "tree-sitter.wasm" ? wasm : path.join(dir, file);
          },
        });
        return true;
      } catch {
        initPromise = null;
        return false;
      }
    })();
  }
  return initPromise;
}

export async function languageForPath(
  filePath: string,
): Promise<{ language: string; wasm: string } | null> {
  try {
    const spec = EXTENSIONS[extensionOf(filePath)];
    if (!spec) return null;
    return { language: spec.language, wasm: path.join(wasmDir(), spec.wasm) };
  } catch {
    return null;
  }
}

async function loadLanguage(wasmPath: string): Promise<TreeSitterLanguage | null> {
  const cached = languageCache.get(wasmPath);
  if (cached) return cached;
  try {
    const ready = await ensureInit();
    if (!ready) return null;
    const loaded = await Language.load(wasmPath);
    languageCache.set(wasmPath, loaded);
    return loaded;
  } catch {
    return null;
  }
}

export async function parseSource(
  filePath: string,
  source: string,
): Promise<{ language: string; root: Node } | null> {
  try {
    const spec = await languageForPath(filePath);
    if (!spec) return null;
    const loaded = await loadLanguage(spec.wasm);
    if (!loaded) return null;
    const parser = new Parser();
    try {
      parser.setLanguage(loaded);
      const tree = parser.parse(source);
      if (!tree) return null;
      return { language: spec.language, root: tree.rootNode };
    } finally {
      parser.delete();
    }
  } catch {
    return null;
  }
}
