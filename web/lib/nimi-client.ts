import { createNimiClient, type NimiLocalAppClient } from "@nimiplatform/sdk";
import {
  createNimiLocalAppStandardShellSurface,
  installNimiShellRuntimeBridge,
} from "@nimiplatform/kit/shell/renderer/bridge";

export const DEEPTUTOR_APP_ID = "org.nimiplatform.deeptutor";
let client: NimiLocalAppClient | undefined;

// Same generated reference wiring, initialized only in the Electron renderer.
export function getNimiLocalAppClient(): NimiLocalAppClient {
  if (!client) {
    installNimiShellRuntimeBridge();
    client = createNimiClient({
      localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
    });
  }
  return client;
}

type ConnectionReader = {
  auth: {
    status(): Promise<{
      sessionBound: boolean;
      reasonCode: string;
      actionHint?: string;
    }>;
  };
  aiConfig: Pick<NimiLocalAppClient["aiConfig"], "get">;
};

/** Formal same-Host recovery read. Never changes configuration or starts AI. */
export async function readNimiModelConfiguration(
  client: ConnectionReader = getNimiLocalAppClient(),
) {
  const status = await client.auth.status();
  if (!status.sessionBound) {
    throw Object.assign(new Error(status.reasonCode), {
      reasonCode: status.reasonCode,
      actionHint: status.actionHint,
    });
  }
  return client.aiConfig.get();
}
