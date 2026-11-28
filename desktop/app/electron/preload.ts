import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DashboardBridge, UpdateStatus } from "./contract.js";

const bridge: DashboardBridge = {
  readHome: () => ipcRenderer.invoke("dashboard:home"),
  readProjects: () => ipcRenderer.invoke("dashboard:projects"),
  readHistory: pagination => ipcRenderer.invoke("dashboard:history", pagination),
  readStatus: () => ipcRenderer.invoke("dashboard:status"),
  readRank: () => ipcRenderer.invoke("dashboard:rank"),
  readDue: () => ipcRenderer.invoke("dashboard:due"),
  readGrowth: days => ipcRenderer.invoke("dashboard:growth", days),
  readMap: () => ipcRenderer.invoke("dashboard:map"),
  readSettings: () => ipcRenderer.invoke("dashboard:settings"),
  writeSettings: event => ipcRenderer.invoke("dashboard:settings-write", event),
  openRecall: topic => ipcRenderer.invoke("app:open-recall", topic),
  readUpdateStatus: () => ipcRenderer.invoke("app:update-status"),
  onUpdateStatus: listener => {
    const wrapped = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on("app:update-status", wrapped);
    return () => { ipcRenderer.removeListener("app:update-status", wrapped); };
  },
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
};
contextBridge.exposeInMainWorld("drawbridge", bridge);
