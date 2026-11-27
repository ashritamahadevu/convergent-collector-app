import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { DashboardClient } from "./client.js";
import type { UpdateStatus } from "./contract.js";

const rendererPath = path.join(__dirname, "renderer", "index.html");
const rendererURL = pathToFileURL(rendererPath).href;
const updateCheckIntervalMs = 4 * 60 * 60 * 1000;
let window: BrowserWindow | null = null;
let latestUpdate: UpdateStatus | null = null;
const client = DashboardClient.fromEnvironment();

function trusted(event: IpcMainInvokeEvent): boolean {
  return !!window && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL;
}

function sendUpdate(status: UpdateStatus) {
  latestUpdate = status;
  if (window && !window.isDestroyed()) window.webContents.send("app:update-status", status);
}

function checkForUpdates() {
  void autoUpdater.checkForUpdates().catch(() => {
    // The error event already reports the failure to the window.
  });
}

function startUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.on("update-available", info => {
    sendUpdate({ phase: "downloading", version: info.version, message: null });
  });
  autoUpdater.on("update-downloaded", info => {
    sendUpdate({ phase: "ready", version: info.version, message: null });
  });
  autoUpdater.on("error", error => {
    sendUpdate({ phase: "error", version: latestUpdate?.version ?? null, message: error.message || "Update check failed." });
  });
  checkForUpdates();
  const timer = setInterval(checkForUpdates, updateCheckIntervalMs);
  app.on("before-quit", () => clearInterval(timer));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 1024, minWidth: 960, minHeight: 720,
    backgroundColor: "#0a0a0a", title: "DrawBridge", autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      webviewTag: false,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.webContents.on("did-finish-load", () => { if (latestUpdate) sendUpdate(latestUpdate); });
  window.on("closed", () => { window = null; });
  void window.loadFile(rendererPath);
}

function focusWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => focusWindow());
  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle("dashboard:history", (event, pagination: unknown) =>
      trusted(event) ? client.readHistory(pagination) : { ok: false, error: "Untrusted dashboard request." });
    ipcMain.handle("dashboard:status", event =>
      trusted(event) ? client.readStatus() : { ok: false, error: "Untrusted dashboard request." });
    ipcMain.handle("app:update-status", event => trusted(event) ? latestUpdate : null);
    ipcMain.handle("app:install-update", event => {
      if (!trusted(event)) return { ok: false, error: "Untrusted dashboard request." };
      if (!app.isPackaged) return { ok: false, error: "Updates run in the installed app." };
      autoUpdater.quitAndInstall(false, true);
      return { ok: true, data: null };
    });
    createWindow();
    startUpdates();
    app.on("activate", () => { if (!window) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
