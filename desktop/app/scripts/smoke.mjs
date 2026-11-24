// End-to-end test of our application, using isolated storage and a random port.
// Never opens the user's database or pairs their extension.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
await build({
  entryPoints: ["../backend/server.ts"], bundle: true, platform: "node",
  format: "cjs", target: "node22", outfile: "build/smoke-backend.cjs",
});
const { startDashboardBackend } = require("../build/smoke-backend.cjs");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "drawbridge-desktop-smoke-"));
const token = randomBytes(32).toString("hex");
let backend;
let desktop;
let closed = false;
const closeBackend = async () => { if (backend && !closed) { closed = true; await backend.close(); } };
try {
  backend = await startDashboardBackend({ databasePath: path.join(directory, "test.sqlite"), token, port: 0 });
  const env = { ...process.env, DRAWBRIDGE_DATA_DIR: directory, DRAWBRIDGE_PORT: new URL(backend.endpoint).port };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: process.cwd(), env, timeout: 30000 });
  const page = await desktop.firstWindow();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await fs.mkdir("test-results", { recursive: true });
  const refresh = async () => {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("button", { name: "Refresh", exact: true }).waitFor();
  };

  await page.getByRole("alert").filter({ hasText: "Pairing configuration unavailable" }).waitFor();
  await page.screenshot({ path: "test-results/pairing-unavailable.png" });
  await fs.writeFile(path.join(directory, "pairing-token"), token);
  await refresh();
  await page.getByRole("heading", { name: "No learning checks yet" }).waitFor();
  await page.screenshot({ path: "test-results/empty.png" });
  console.log("PASS: Electron opens; missing configuration and empty history are visible.");

  const event = (index) => ({
    schemaVersion: 1, type: "review.recorded", eventId: randomUUID(), installationId: "isolated-smoke",
    occurredAt: Date.now() + index - 1000,
    project: { id: "isolated-fixture", name: "Isolated automated test" },
    question: index === 20 ? "<img src=x onerror=alert(1)> is plain text" : "Fixture question " + index,
      answer: "Isolated answer " + index, feedback: "Isolated feedback " + index, misconception: "Fixture misconception",
      concepts: ["test-fixtures"], outcome: index === 20 ? "bypass" : "pass", score: index === 20 ? null : 0.7,
      source: "isolated-test", mode: "test", filePath: "src/fixture.ts", retries: 2,
      topic: "testing", shape: "general", groupId: "fixture-group-" + index, masteryAfter: null,
  });
  const send = async value => {
    const res = await fetch(backend.endpoint + "/v1/events", {
      method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    assert.equal(res.status, 200);
  };
  const first = event(0);
  await send(first);
  await send(first);
  for (let i = 1; i <= 20; i++) await send(event(i));
  await refresh();
  await page.locator(".live-question").filter({ hasText: "<img src=x onerror=alert(1)> is plain text" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 20);
  assert.equal(await page.locator("tbody img").count(), 0);
  await page.locator("tbody summary").first().click();
  await page.getByText("Isolated answer 20", { exact: true }).waitFor();
  await page.getByText("Isolated feedback 20", { exact: true }).waitFor();
  await page.getByText("Not scored", { exact: true }).waitFor();
  assert.equal(await page.locator("img[alt=DrawBridge]").evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.screenshot({ path: "test-results/history.png" });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator(".live-question").filter({ hasText: /^Fixture question 0$/ }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.locator(".live-question").filter({ hasText: "<img src=x onerror=alert(1)> is plain text" }).waitFor();
  console.log("PASS: Real HTTP/SQLite fixture records, Refresh, duplicate handling, details, unscored outcomes and pagination.");

  assert.deepEqual(await page.evaluate(() => ({
    methods: Object.keys(window.drawbridge).sort(),
    node: typeof window.require, process: typeof window.process,
  })), { methods: ["readHistory", "readStatus"], node: "undefined", process: "undefined" });
  const invalid = await page.evaluate(() => window.drawbridge.readHistory({ limit: 201, offset: 0 }));
  assert.equal(invalid.ok, false);
  const prefs = await desktop.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity };
  });
  assert.deepEqual(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  await page.evaluate(() => window.open("https://example.com"));
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByText("Design prototype · Sample data · Only History is connected to your saved checks.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".live-question").filter({ hasText: "<img src=x onerror=alert(1)> is plain text" }).waitFor();
  console.log("PASS: Sandboxed renderer, restricted bridge, validated pagination, blocked new windows and prototype labels.");

  await closeBackend();
  await refresh();
  await page.getByRole("alert").filter({ hasText: "Local backend unavailable" }).waitFor();
  await page.screenshot({ path: "test-results/backend-unavailable.png" });
  assert.deepEqual(pageErrors, []);
  console.log("PASS: Stopped-backend state. No renderer errors. Screenshots saved under desktop/app/test-results/.");
} finally {
  if (desktop) await desktop.close();
  await closeBackend();
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
