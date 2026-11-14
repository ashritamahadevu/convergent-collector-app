import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomBytes } from "node:crypto";
import { startDashboardBackend } from "./server";

async function main() {
  const directory = path.resolve(process.env.DRAWBRIDGE_DATA_DIR ?? path.join(os.homedir(), ".drawbridge"));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const tokenPath = path.join(directory, "pairing-token");
  let token: string;
  try { token = (await fs.readFile(tokenPath, "utf8")).trim(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    token = randomBytes(32).toString("hex");
    await fs.writeFile(tokenPath, token, { mode: 0o600, flag: "wx" });
  }
  const port = Number(process.env.DRAWBRIDGE_PORT ?? 43821);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DRAWBRIDGE_PORT");
  const backend = await startDashboardBackend({ databasePath: path.join(directory, "dashboard.sqlite"), token, port });
  console.log("Dashboard backend: " + backend.endpoint);
  console.log("Pairing token file: " + tokenPath);
  console.log("Run 'Comprehension Guard: Connect Desktop Dashboard' in VS Code and select that file.");
  let closing = false;
  const stop = () => { if (!closing) { closing = true; void backend.close().catch(() => { process.exitCode = 1; }); } };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
void main().catch(e => { console.error(e instanceof Error ? e.message : "Could not start dashboard"); process.exitCode = 1; });
