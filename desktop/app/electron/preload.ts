import { contextBridge, ipcRenderer } from "electron";
import type { DashboardBridge } from "./contract.js";

const bridge: DashboardBridge = {
  readHome: () => ipcRenderer.invoke("dashboard:home"),
  readProjects: () => ipcRenderer.invoke("dashboard:projects"),
  readHistory: pagination => ipcRenderer.invoke("dashboard:history", pagination),
  readStatus: () => ipcRenderer.invoke("dashboard:status"),
};
contextBridge.exposeInMainWorld("drawbridge", bridge);
