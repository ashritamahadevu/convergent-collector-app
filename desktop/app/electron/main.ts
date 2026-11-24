import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { DashboardClient } from "./client.js";

const rendererPath = path.join(__dirname, "renderer", "index.html");
const rendererURL = pathToFileURL(rendererPath).href;
let window: BrowserWindow | null = null;
const client = DashboardClient.fromEnvironment();

function trusted(event: IpcMainInvokeEvent): boolean {
  return !!window && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererURL;
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
  window.on("closed", () => { window = null; });
  void window.loadFile(rendererPath);
}

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  ipcMain.handle("dashboard:history", (event, pagination: unknown) =>
    trusted(event) ? client.readHistory(pagination) : { ok: false, error: "Untrusted dashboard request." });
  ipcMain.handle("dashboard:status", event =>
    trusted(event) ? client.readStatus() : { ok: false, error: "Untrusted dashboard request." });
  createWindow();
  app.on("activate", () => { if (!window) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
