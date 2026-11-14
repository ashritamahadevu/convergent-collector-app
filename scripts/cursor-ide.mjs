import path from "node:path";

/** The standalone agent shim prints this and refuses IDE commands such as --install-extension. */
export function isAgentShim(text) {
  if (!text) {
    return false;
  }
  return (
    text.includes("cursor-agent") ||
    text.includes("No Cursor IDE installation found")
  );
}

export function ideCandidatePaths(platform, home, env = {}) {
  if (platform === "darwin") {
    return [
      "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
      path.posix.join(home.replace(/\\/g, "/"), "Applications", "Cursor.app", "Contents", "Resources", "app", "bin", "cursor"),
    ];
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [
      path.join(local, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd"),
      path.join(local, "Programs", "Cursor", "resources", "app", "bin", "cursor.cmd"),
    ];
  }
  return [
    "/usr/share/cursor/resources/app/bin/cursor",
    "/usr/share/cursor/bin/cursor",
    "/opt/Cursor/resources/app/bin/cursor",
    "/opt/cursor/resources/app/bin/cursor",
    path.join(home, ".local", "share", "cursor", "resources", "app", "bin", "cursor"),
  ];
}

/**
 * "ide" can install a VSIX. "agent" is the `cursor agent` shim and cannot.
 * "unknown" is a binary we should not guess about.
 */
export function classifyCursorBinary(filePath, text) {
  const normalized = filePath.replace(/\\/g, "/");
  if (
    normalized.endsWith("/.local/bin/cursor") ||
    normalized.endsWith("/.local/bin/cursor-agent") ||
    normalized.endsWith("/bin/agent")
  ) {
    return "agent";
  }
  if (isAgentShim(text)) {
    return "agent";
  }
  if (
    normalized.includes("/Cursor.app/Contents/") ||
    normalized.includes("/resources/app/bin/cursor") ||
    normalized.endsWith("/Cursor.exe")
  ) {
    return "ide";
  }
  if (text && text.includes("Electron") || (text && text.includes("--install-extension"))) {
    return "ide";
  }
  return "unknown";
}
