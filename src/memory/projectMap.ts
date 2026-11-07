export type ProjectFile = {
  path: string;
  core: boolean;
  reason: string;
  centrality: number;
  complexity: number;
  imports: string[];
};

const BOILERPLATE =
  /(^|\/)(templates?|static|styles?|dist|build|coverage|node_modules|vendor)(\/|$)|requirements\.txt$|package-lock\.json$|\.css$|\.scss$|\.html$|\.md$|\.json$|\.yml$|\.yaml$|\.toml$|\.lock$/i;

const IMPORT_RE =
  /(?:import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|from\s+([.\w/]+)\s+import|#include\s*[<"]([^>"]+)[>"])/g;

export function parseImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] || match[2] || match[3] || match[4];
    if (spec) {
      found.push(spec);
    }
  }
  return found;
}

export function complexityOf(source: string): number {
  const branches = source.match(/\b(if|for|while|catch|switch|elif)\b/g)?.length ?? 0;
  const symbols = source.match(/\b(function|class|def|fn|func)\b/g)?.length ?? 0;
  return branches + symbols * 2;
}

function resolveImport(spec: string, fromPath: string, paths: string[]): string | undefined {
  const cleaned = spec.replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx|py)$/, "");
  const base = cleaned.split("/").pop() ?? cleaned;
  if (spec.startsWith(".")) {
    const dir = fromPath.split("/").slice(0, -1).join("/");
    const target = (dir + "/" + cleaned).replace(/\/+/g, "/");
    return paths.find((p) => p.replace(/\.(ts|tsx|js|jsx|py)$/, "") === target || p.endsWith("/" + base + ".py") || p.endsWith("/" + base + ".ts"));
  }
  return paths.find((p) => p.endsWith("/" + base + ".py") || p.endsWith("/" + base + ".ts") || p.endsWith("/" + base + ".js") || p === base);
}

export function buildProjectMap(files: { path: string; text: string }[]): ProjectFile[] {
  const paths = files.map((file) => file.path.replace(/\\/g, "/"));
  const imports = new Map<string, string[]>();
  for (const file of files) {
    const path = file.path.replace(/\\/g, "/");
    const specs = parseImports(file.text);
    imports.set(
      path,
      specs
        .map((spec) => resolveImport(spec, path, paths))
        .filter((item): item is string => Boolean(item)),
    );
  }
  const inbound = new Map<string, number>();
  for (const path of paths) {
    inbound.set(path, 0);
  }
  for (const targets of imports.values()) {
    for (const target of targets) {
      inbound.set(target, (inbound.get(target) ?? 0) + 1);
    }
  }
  return files.map((file) => {
    const path = file.path.replace(/\\/g, "/");
    const outgoing = imports.get(path) ?? [];
    const centrality = (inbound.get(path) ?? 0) + outgoing.length;
    const complexity = complexityOf(file.text);
    const boilerplate = BOILERPLATE.test(path);
    const core = !boilerplate && (centrality > 0 || complexity >= 2 || /(^|\/)(app|main|index)\./.test(path));
    return {
      path,
      core,
      reason: boilerplate ? "config, markup, or generated" : core ? "application logic" : "no connections and little logic",
      centrality,
      complexity,
      imports: outgoing,
    };
  }).sort((a, b) => Number(b.core) - Number(a.core) || b.centrality - a.centrality || b.complexity - a.complexity);
}
