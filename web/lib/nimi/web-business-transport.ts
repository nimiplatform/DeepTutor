import { webBusinessCall, businessRoute } from './web-connection';
import {
  MAX_TRANSFER_BYTES,
  TRANSFER_CHUNK_BYTES,
  RESULT_CHUNK_BYTES,
  type BusinessResponse,
} from '../../../electron/remote-contract';

const encode = (bytes: Uint8Array) => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(value);
};

const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const pause = () => new Promise((resolve) => setTimeout(resolve, 150));

let installed = false;

function isBusinessUrl(url: URL): boolean {
  if (url.origin !== location.origin) return false;
  if (!/^\/(api|files)\//.test(url.pathname)) return false;
  if (/^\/api\/(?:runtime-access\/|auth\/runtime-clients\/)/.test(url.pathname)) return false;
  return true;
}

async function executeBusinessRequest(request: Request): Promise<Response> {
  const url = new URL(request.url, location.origin);
  const method = request.method.toUpperCase();
  const path = url.pathname + url.search;
  const allowedHeaders: Record<string, string> = {};
  for (const name of ['content-type', 'range']) {
    const value = request.headers.get(name);
    if (value) allowedHeaders[name] = value;
  }

  const id = crypto.randomUUID();
  let stopped = false;
  let offset = 0;
  let polling = false;
  let headerSent = false;
  let started = false;
  let submitted = false;
  let uploadId: string | undefined;

  let resolveHeaders!: (meta: { status: number; headers?: Record<string, string> }) => void;
  let rejectHeaders!: (error: Error) => void;
  const headersReady = new Promise<{ status: number; headers?: Record<string, string> }>(
    (resolve, reject) => {
      resolveHeaders = resolve;
      rejectHeaders = reject;
    },
  );

  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const stopRequest = () =>
    webBusinessCall('request.stop', { id })
      .then(() => webBusinessCall('request.release', { id }))
      .catch(() => {});

  const failAll = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (!headerSent) rejectHeaders(error);
    try {
      streamController?.error(error);
    } catch {
      /* stream already closed */
    }
  };

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
        ) {
          throw new Error(result.error || `DeepTutor request ${result.state}`);
        }
        if (result.status && !headerSent) {
          headerSent = true;
          resolveHeaders({ status: result.status, headers: result.headers });
        }
        if (result.data) {
          const bytes = decode(result.data);
          if (
            result.offset !== offset ||
            result.nextOffset !== offset + bytes.length ||
            bytes.length > RESULT_CHUNK_BYTES
          ) {
            throw new Error('Invalid DeepTutor response range');
          }
          offset += bytes.length;
          streamController?.enqueue(bytes);
          break;
        }
        if (result.state === 'completed') {
          if (!headerSent) {
            headerSent = true;
            resolveHeaders({ status: result.status || 200, headers: result.headers });
          }
          stopped = true;
          try {
            streamController?.close();
          } catch {
            /* stream already closed */
          }
          await webBusinessCall('request.release', { id });
          break;
        }
        await pause();
      }
    } catch (cause) {
      stopped = true;
      failAll(cause);
    } finally {
      polling = false;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    pull() {
      void poll();
    },
    cancel() {
      stopped = true;
      if (started) void stopRequest();
    },
  });

  if (request.signal.aborted) {
    throw new DOMException('Request was cancelled', 'AbortError');
  }
  request.signal.addEventListener(
    'abort',
    () => {
      stopped = true;
      failAll(new DOMException('Request was cancelled', 'AbortError'));
      if (started) void stopRequest();
    },
    { once: true },
  );

  void (async () => {
    try {
      const route = businessRoute(method, path);
      const bytes =
        method === 'GET' || method === 'HEAD'
          ? new Uint8Array(0)
          : new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_TRANSFER_BYTES) {
        throw new Error('DeepTutor upload exceeds 512 MiB');
      }
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
        route: route.route,
        parameters: route.parameters,
        query: route.query,
        headers: allowedHeaders,
        ...(uploadId ? { bodyId: uploadId } : {}),
      });
      started = true;
      if (stopped) {
        await stopRequest();
        return;
      }
      await poll();
    } catch (cause) {
      stopped = true;
      failAll(cause);
    } finally {
      if (uploadId && !submitted) {
        await webBusinessCall('upload', { action: 'release', id: uploadId }).catch(() => {});
      }
    }
  })();

  try {
    const meta = await headersReady;
    return new Response([204, 205, 304].includes(meta.status) ? null : stream, {
      status: meta.status,
      headers: meta.headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return new Response(
      JSON.stringify({ detail: error instanceof Error ? error.message : String(error) }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
}

function installMediaSrcObserver() {
  const activeUrls = new WeakMap<Element, { raw: string; blobUrl: string }>();

  const hydrate = (node: Element) => {
    if (
      !(
        node instanceof HTMLImageElement ||
        node instanceof HTMLMediaElement ||
        node instanceof HTMLSourceElement
      )
    ) {
      return;
    }
    const raw = node.getAttribute('src');
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return;
    let parsed: URL;
    try {
      parsed = new URL(raw, location.origin);
    } catch {
      return;
    }
    if (!isBusinessUrl(parsed)) return;
    const current = activeUrls.get(node);
    if (current && current.raw === parsed.href) return;
    const requestedHref = parsed.href;
    void fetch(requestedHref)
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (!node.isConnected) return;
        const previous = activeUrls.get(node);
        if (previous) URL.revokeObjectURL(previous.blobUrl);
        const blobUrl = URL.createObjectURL(blob);
        activeUrls.set(node, { raw: requestedHref, blobUrl });
        node.setAttribute('src', blobUrl);
      })
      .catch(() => {});
  };

  const scan = (root: ParentNode) => {
    if (root instanceof Element) hydrate(root);
    for (const el of root.querySelectorAll('img[src],audio[src],video[src],source[src]')) {
      hydrate(el);
    }
  };

  if (document.documentElement) {
    scan(document.documentElement);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) {
          hydrate(record.target);
        } else {
          for (const added of record.addedNodes) {
            if (added instanceof Element) scan(added);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  }
}

/** In-document business fetch and media interception over this document's captured parent MessagePort. */
export function installBusinessFetch() {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url, location.origin);
    if (!isBusinessUrl(url)) {
      return nativeFetch(input, init);
    }
    return executeBusinessRequest(request);
  };
  installMediaSrcObserver();
}
