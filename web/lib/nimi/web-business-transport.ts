import { webBusinessCall, businessRoute } from './web-connection';
import {
  MAX_TRANSFER_BYTES,
  TRANSFER_CHUNK_BYTES,
  RESULT_CHUNK_BYTES,
  type BusinessResponse,
} from '../../../electron/remote-contract';
const encode = (bytes: Uint8Array) => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const pause = () => new Promise((resolve) => setTimeout(resolve, 150));

/** SW messages arrive only in their actual requesting document; each document has one captured parent port. */
export function installBusinessFetch() {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'deeptutor-business-fetch' || !event.ports[0]) return;
    const port = event.ports[0];
    const id = crypto.randomUUID();
    let stopped = false,
      offset = 0;
    let polling = false;
    let headerSent = false;
    let started = false;
    let submitted = false;
    let uploadId: string | undefined;
    const stopRequest = () =>
      webBusinessCall('request.stop', { id })
        .then(() => webBusinessCall('request.release', { id }))
        .catch(() => {});
    async function poll() {
      if (polling || stopped || !started) return;
      polling = true;
      try {
        while (!stopped) {
          const result = await webBusinessCall<BusinessResponse>('request.read', { id, offset });
          if (
            result.state === 'unknown' ||
            result.state === 'failed' ||
            result.state === 'canceled'
          )
            throw new Error(result.error || `DeepTutor request ${result.state}`);
          if (result.status && !headerSent) {
            port.postMessage({ type: 'headers', status: result.status, headers: result.headers });
            headerSent = true;
          }
          if (result.data) {
            const bytes = decode(result.data);
            if (
              result.offset !== offset ||
              result.nextOffset !== offset + bytes.length ||
              bytes.length > RESULT_CHUNK_BYTES
            )
              throw new Error('Invalid DeepTutor response range');
            offset += bytes.length;
            port.postMessage({ type: 'data', bytes: bytes.buffer }, [bytes.buffer]);
            break;
          }
          if (result.state === 'completed') {
            port.postMessage({ type: 'end' });
            await webBusinessCall('request.release', { id });
            stopped = true;
            break;
          }
          await pause();
        }
      } catch (cause) {
        stopped = true;
        port.postMessage({ type: 'error', error: String(cause) });
      } finally {
        polling = false;
      }
    }
    port.onmessage = (message) => {
      if (message.data?.type === 'pull') void poll();
      if (message.data?.type === 'cancel') {
        stopped = true;
        if (started) void stopRequest();
      }
    };
    port.start();
    void (async () => {
      try {
        const request = event.data;
        const route = businessRoute(request.method, request.path);
        const bytes = new Uint8Array(request.body || new ArrayBuffer(0));
        if (bytes.length > MAX_TRANSFER_BYTES)
          throw new Error('DeepTutor upload exceeds 512 MiB');
        if (bytes.length) {
          uploadId = (
            await webBusinessCall<{ id: string }>('upload', { action: 'begin', size: bytes.length })
          ).id;
          for (let position = 0; position < bytes.length; position += TRANSFER_CHUNK_BYTES) {
            if (stopped) return;
            await webBusinessCall('upload', {
              action: 'append',
              id: uploadId,
              offset: position,
              data: encode(bytes.subarray(position, position + TRANSFER_CHUNK_BYTES)),
            });
          }
          await webBusinessCall('upload', { action: 'finish', id: uploadId });
        }
        if (stopped) return;
        submitted = true;
        await webBusinessCall(route.operation, {
          requestId: id,
          route: route.route, parameters: route.parameters, query: route.query,
          headers: request.headers,
          ...(uploadId ? { bodyId: uploadId } : {}),
        });
        started = true;
        if (stopped) {
          await stopRequest();
          return;
        }
        await poll();
      } catch (cause) {
        port.postMessage({ type: 'error', error: String(cause) });
      } finally {
        if (uploadId && !submitted)
          await webBusinessCall('upload', { action: 'release', id: uploadId }).catch(() => {});
      }
    })();
  });
}
