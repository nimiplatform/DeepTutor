export const INTEGRATION_ID = 'deeptutor.workspace.v3';
// The existing Python worker uses Uvicorn's 16 MiB WebSocket message limit.
export const MAX_SOCKET_MESSAGE_BYTES = 16 * 1024 * 1024;
export const MAX_TRANSFER_BYTES = 512 * 1024 * 1024;
export const TRANSFER_CHUNK_BYTES = 64 * 1024;
export const RESULT_CHUNK_BYTES = 128 * 1024;
export type BusinessResponse = {
  state: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | 'unknown';
  status?: number; headers?: Record<string, string>; offset?: number; nextOffset?: number;
  data?: string; error?: string;
};
