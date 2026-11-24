import type { DashboardBridge } from "../electron/contract";
declare global { interface Window { drawbridge?: DashboardBridge } }
