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

  await page.getByText("Grub", { exact: true }).waitFor();
  const loadedFonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = await Promise.all([
      document.fonts.load('400 16px "Inter"'),
      document.fonts.load('400 16px "Inter:Regular"'),
      document.fonts.load('500 16px "Inter:Medium"'),
      document.fonts.load('600 16px "Inter:Semi Bold"'),
      document.fonts.load('700 16px "Inter:Bold"'),
    ]);
    return faces.every(group => group.length > 0 && group.every(face => face.status === "loaded"));
  });
  assert.equal(loadedFonts, true);
  const fontSession = await page.context().newCDPSession(page);
  await fontSession.send("DOM.enable");
  await fontSession.send("CSS.enable");
  const { root } = await fontSession.send("DOM.getDocument");
  const { nodeId } = await fontSession.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".home-projects-control" });
  const { fonts } = await fontSession.send("CSS.getPlatformFontsForNode", { nodeId });
  assert.ok(fonts.some(font => font.isCustomFont && font.familyName.includes("Inter")), "Visible text uses bundled Inter rather than a system fallback");
  await fontSession.detach();
  console.log("PASS: Bundled Inter renders visible text; all Figma weight aliases load.");
  await page.getByRole("heading", { name: "Stats · Demo", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Recent checks", exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "Pairing configuration unavailable" }).waitFor();
  assert.equal(await page.getByText("Coalescing free blocks", { exact: true }).count(), 0);
  await page.getByText("Peasant", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/home-restored.png" });
  await page.getByRole("button", { name: "Browse projects", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Pairing configuration unavailable" }).waitFor();
  await page.screenshot({ path: "test-results/pairing-unavailable.png" });
  await fs.writeFile(path.join(directory, "pairing-token"), token);
  await refresh();
  await page.getByRole("heading", { name: "No projects yet" }).waitFor();
  await page.screenshot({ path: "test-results/projects-empty.png" });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("heading", { name: "No learning checks yet" }).waitFor();
  await page.screenshot({ path: "test-results/empty.png" });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("article", { name: "Weak point 1", exact: true }).getByText("Not assessed yet", { exact: true }).waitFor();
  await page.getByRole("article", { name: "Recent check 1", exact: true }).getByText("No check", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/home-empty.png" });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("heading", { name: "No learning checks yet" }).waitFor();
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
  await page.locator(".history-check-toggle").first().click();
  await page.getByText("Isolated answer 20", { exact: true }).waitFor();
  await page.getByText("Isolated feedback 20", { exact: true }).waitFor();
  await page.getByText("Not scored", { exact: true }).waitFor();
  assert.equal(await page.locator("img[alt=DrawBridge]").evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.screenshot({ path: "test-results/history.png" });
  await page.locator(".history-check-toggle").first().click();
  await page.screenshot({ path: "test-results/history-table.png" });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator(".live-question").filter({ hasText: /^Fixture question 0$/ }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.locator(".live-question").filter({ hasText: "<img src=x onerror=alert(1)> is plain text" }).waitFor();
  console.log("PASS: Real HTTP/SQLite fixture records, Refresh, duplicate handling, details, unscored outcomes and pagination.");

  assert.deepEqual(await page.evaluate(() => ({
    methods: Object.keys(window.drawbridge).sort(),
    node: typeof window.require, process: typeof window.process,
  })), { methods: ["readHistory", "readHome", "readProjects", "readStatus"], node: "undefined", process: "undefined" });
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
  await page.getByText("Grub", { exact: true }).waitFor();
  await page.getByRole("article", { name: "Weak point 1", exact: true }).getByText("test-fixtures", { exact: true }).waitFor();
  await page.getByRole("article", { name: "Recent check 1", exact: true }).getByText("Not scored", { exact: true }).waitFor();
  await page.getByRole("article", { name: "Recent check 2", exact: true }).getByText("70%", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/home-live.png" });
  const newCheck = event(22); newCheck.score = 0.25; newCheck.outcome = "fail";
  newCheck.concepts = ["new-weak-concept"]; await send(newCheck);
  await refresh();
  await page.getByRole("article", { name: "Weak point 1", exact: true }).getByText("new-weak-concept", { exact: true }).waitFor();
  await page.getByRole("article", { name: "Recent check 1", exact: true }).getByText("25%", { exact: true }).waitFor();
  await page.screenshot({ path: "test-results/home-refreshed.png" });
  await page.getByRole("button", { name: "Browse projects", exact: true }).click();
  const projectCard = page.getByRole("article", { name: "Project: Isolated automated test", exact: true });
  await projectCard.getByRole("button", { name: "Open History", exact: true }).waitFor();
  assert.equal(await projectCard.locator(".project-score strong").innerText(), "3.39 / 5");
  assert.equal(await projectCard.locator(".project-counts dd").allInnerTexts().then(values => values.join(",")), "22,21,1");
  await page.screenshot({ path: "test-results/projects.png" });
  const unassessed = event(21);
  unassessed.project = { id: "second-project", name: "Unassessed project" };
  unassessed.outcome = "ungraded"; unassessed.score = null;
  await send(unassessed);
  await refresh();
  const secondCard = page.getByRole("article", { name: "Project: Unassessed project", exact: true });
  await secondCard.getByRole("button", { name: "Open History", exact: true }).waitFor();
  assert.equal(await secondCard.locator(".project-score strong").innerText(), "Not assessed yet");
  await page.screenshot({ path: "test-results/projects-two.png" });
  await secondCard.getByRole("button", { name: "Open History", exact: true }).click();
  await page.getByText("Fixture question 21", { exact: true }).first().waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.equal(await page.getByRole("combobox", { name: "Project", exact: true }).inputValue(), "second-project");
  await page.getByRole("combobox", { name: "Project", exact: true }).selectOption("isolated-fixture");
  await page.locator(".live-question").filter({ hasText: "<img src=x onerror=alert(1)> is plain text" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 20);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator(".live-question").filter({ hasText: /^Fixture question 0$/ }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 2);
  await page.getByRole("combobox", { name: "Project", exact: true }).selectOption("second-project");
  await page.locator(".live-question").filter({ hasText: /^Fixture question 21$/ }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await refresh();
  assert.equal(await page.getByRole("combobox", { name: "Project", exact: true }).inputValue(), "second-project");
  await page.getByRole("combobox", { name: "Project", exact: true }).selectOption("");
  await page.locator(".live-question").filter({ hasText: /^Fixture question 21$/ }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 20);
  await page.getByRole("button", { name: "Growth", exact: true }).click();
  await page.getByText("Design prototype · Sample data · Projects and History use your saved checks.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".live-question").filter({ hasText: "<img src=x onerror=alert(1)> is plain text" }).waitFor();
  console.log("PASS: Real project summaries, unassessed state, project selection, filtered pagination and selection-preserving Refresh.");
  console.log("PASS: Sandboxed renderer, restricted bridge, validated pagination, blocked new windows and prototype labels.");

  const assertBridgeVisible = async () => {
    assert.equal(await page.locator(".drawbridge-bridge").count(), 1);
    const bounds = await page.locator(".drawbridge-bridge").evaluate(img => {
      const r = img.getBoundingClientRect();
      return {
        loaded: img.complete && img.naturalWidth > 0,
        src: img.getAttribute("src"), width: r.width,
        contained: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      };
    });
    assert.equal(bounds.loaded, true);
    assert.equal(bounds.contained, true);
    assert.equal(bounds.src, "./assets/home/0687b.svg");
    return bounds.width;
  };
  for (const screen of ["Home", "Growth", "Map", "History"]) {
    await page.getByRole("button", { name: screen, exact: true }).click();
    await assertBridgeVisible();
    await page.screenshot({ path: "test-results/bridge-" + screen.toLowerCase() + ".png" });
  }
  const originalSize = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  const widths = [];
  for (const size of [[960, 720], [1920, 900], [1100, 1000]]) {
    await desktop.evaluate(({ BrowserWindow }, [width, height]) => {
      BrowserWindow.getAllWindows()[0].setContentSize(width, height);
    }, size);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    widths.push(await assertBridgeVisible());
    await page.screenshot({ path: "test-results/bridge-" + size.join("x") + ".png" });
  }
  assert.ok(new Set(widths.map(width => Math.round(width))).size > 1, "Bridge resizes with the window");
  await desktop.evaluate(({ BrowserWindow }, [width, height]) => {
    BrowserWindow.getAllWindows()[0].setContentSize(width, height);
  }, originalSize);
  console.log("PASS: One shared bridge asset stays inside Home, History, Growth and Map at minimum, wide and tall window sizes.");

  await closeBackend();
  await refresh();
  await page.getByRole("alert").filter({ hasText: "Local backend unavailable" }).waitFor();
  await page.screenshot({ path: "test-results/backend-unavailable.png" });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Local backend unavailable" }).waitFor();
  await page.screenshot({ path: "test-results/home-unavailable.png" });
  assert.deepEqual(pageErrors, []);
  console.log("PASS: Stopped-backend state. No renderer errors. Screenshots saved under desktop/app/test-results/.");
} finally {
  if (desktop) await desktop.close();
  await closeBackend();
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
