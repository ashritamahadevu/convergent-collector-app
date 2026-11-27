import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DashboardBridge, UpdateStatus } from "./contract.js";

const bridge: DashboardBridge = {
  readHistory: pagination => ipcRenderer.invoke("dashboard:history", pagination),
  readStatus: () => ipcRenderer.invoke("dashboard:status"),
  readUpdateStatus: () => ipcRenderer.invoke("app:update-status"),
  onUpdateStatus: listener => {
    const wrapped = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
    ipcRenderer.on("app:update-status", wrapped);
    return () => { ipcRenderer.removeListener("app:update-status", wrapped); };
  },
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
};
contextBridge.exposeInMainWorld("drawbridge", bridge);
