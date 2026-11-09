/**
 * Import this FIRST in a test file. It makes `require("vscode")` (used by the
 * compiled src/ modules) resolve to ./vscodeStub.ts.
 */
import Module from "node:module";
import path from "node:path";

const stubPath = path.join(__dirname, "vscodeStub.ts");
const mod = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
const original = mod._resolveFilename;
mod._resolveFilename = function (request: string, ...rest: unknown[]): string {
  if (request === "vscode") {
    return stubPath;
  }
  return original.call(this, request, ...rest);
};
