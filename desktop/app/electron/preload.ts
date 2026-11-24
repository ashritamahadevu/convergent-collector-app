import { contextBridge, ipcRenderer } from "electron";
import type { DashboardBridge } from "./contract.js";

const bridge: DashboardBridge = {
  readHistory: pagination => ipcRenderer.invoke("dashboard:history", pagination),
  readStatus: () => ipcRenderer.invoke("dashboard:status"),
};
contextBridge.exposeInMainWorld("drawbridge", bridge);
