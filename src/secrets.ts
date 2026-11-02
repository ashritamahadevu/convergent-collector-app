import * as vscode from "vscode";
import type { Provider } from "./types";

function secretKey(provider: Provider): string {
  return `comprehensionGuard.apiKey.${provider}`;
}

export async function getApiKey(
  context: vscode.ExtensionContext,
  provider: Provider,
): Promise<string | undefined> {
  return context.secrets.get(secretKey(provider));
}

export async function setApiKey(
  context: vscode.ExtensionContext,
  provider: Provider,
  key: string,
): Promise<void> {
  await context.secrets.store(secretKey(provider), key);
}

export async function clearApiKey(
  context: vscode.ExtensionContext,
  provider: Provider,
): Promise<void> {
  await context.secrets.delete(secretKey(provider));
}
