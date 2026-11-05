import assert from "node:assert/strict";
import test from "node:test";
import { classifyCursorBinary, ideCandidatePaths, isAgentShim } from "./cursor-ide.mjs";

const SHIM = `#!/bin/sh
if [ "$1" != "agent" ]; then
  echo "Error: No Cursor IDE installation found. Use 'cursor agent' or 'agent' to run the agent." 1>&2
  exit 1
fi
exec "$HOME/.local/bin/cursor-agent" "$@"
`;

test("the agent shim is not treated as the Cursor app", () => {
  assert.equal(isAgentShim(SHIM), true);
  assert.equal(
    classifyCursorBinary("/Users/ashrita/.local/bin/cursor", SHIM),
    "agent",
  );
  assert.equal(
    classifyCursorBinary("/usr/local/bin/cursor", SHIM),
    "agent",
  );
});

test("the app bundle can install a VSIX", () => {
  assert.equal(
    classifyCursorBinary(
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      "#!/usr/bin/env electron\n",
    ),
    "ide",
  );
  const mac = ideCandidatePaths("darwin", "/Users/ashrita");
  assert.equal(mac[0], "/Applications/Cursor.app/Contents/Resources/app/bin/cursor");
  assert.match(mac[1], /\/Users\/ashrita\/Applications\/Cursor\.app\//);
});
