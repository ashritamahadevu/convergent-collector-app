// Kept standalone so the check runs before any import of node:sqlite.
function assertDashboardRuntime(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 22 || (major === 22 && minor < 13)) {
    throw new Error("Desktop dashboard backend requires Node.js 22.13 or newer with node:sqlite support. Current version: v" + version);
  }
}
module.exports = { assertDashboardRuntime };
if (require.main === module) {
  try { assertDashboardRuntime(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
