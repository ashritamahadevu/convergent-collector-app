/**
 * Copy the tree-sitter runtime into runtime/ so a GitHub download and a VSIX
 * can load it without node_modules.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtime = path.join(root, "runtime");
const parserSrc = path.join(root, "node_modules", "web-tree-sitter");
const grammarSrc = path.join(root, "node_modules", "tree-sitter-wasms", "out");
const marker = path.join(runtime, "web-tree-sitter", "tree-sitter.wasm");

const GRAMMARS = [
  "tree-sitter-javascript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-c.wasm",
  "tree-sitter-cpp.wasm",
  "tree-sitter-go.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-java.wasm",
  "tree-sitter-c_sharp.wasm",
  "tree-sitter-ruby.wasm",
  "tree-sitter-php.wasm",
  "tree-sitter-kotlin.wasm",
  "tree-sitter-swift.wasm",
  "tree-sitter-lua.wasm",
  "tree-sitter-bash.wasm",
];

if (!fs.existsSync(parserSrc) || !fs.existsSync(grammarSrc)) {
  if (fs.existsSync(marker)) {
    console.log("tree-sitter runtime already present");
    process.exit(0);
  }
  console.error("Install dependencies before copying the tree-sitter runtime.");
  process.exit(1);
}

const parserDest = path.join(runtime, "web-tree-sitter");
const grammarDest = path.join(runtime, "tree-sitter-wasms", "out");
fs.mkdirSync(parserDest, { recursive: true });
fs.mkdirSync(grammarDest, { recursive: true });

for (const file of ["tree-sitter.cjs", "tree-sitter.wasm", "LICENSE", "package.json"]) {
  fs.copyFileSync(path.join(parserSrc, file), path.join(parserDest, file));
}
const grammarLicense = path.join(root, "node_modules", "tree-sitter-wasms", "LICENSE");
if (fs.existsSync(grammarLicense)) {
  fs.copyFileSync(grammarLicense, path.join(runtime, "tree-sitter-wasms", "LICENSE"));
}
for (const file of GRAMMARS) {
  fs.copyFileSync(path.join(grammarSrc, file), path.join(grammarDest, file));
}

const parserPkg = JSON.parse(fs.readFileSync(path.join(parserSrc, "package.json"), "utf8"));
const grammarPkg = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules", "tree-sitter-wasms", "package.json"), "utf8"),
);
fs.writeFileSync(
  path.join(runtime, "versions.json"),
  JSON.stringify(
    { "web-tree-sitter": parserPkg.version, "tree-sitter-wasms": grammarPkg.version },
    null,
    2,
  ) + "\n",
);
console.log(
  "copied tree-sitter runtime " + parserPkg.version + " and " + GRAMMARS.length + " grammars",
);
