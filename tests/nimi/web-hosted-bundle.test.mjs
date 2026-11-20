import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { tsImport } from 'tsx/esm/api';

const { DeepTutorWebProvider } = await tsImport('../../electron/remote-provider.ts', import.meta.url);

test('in-document Web business transport serves GET, chunked POST and 1.7.4 routes without a Service Worker', async (t) => {
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    received.push({ method: req.method, url: req.url, body });
    if (req.url === '/api/calendar/events') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ events: [{ id: 'ev-174', title: 'Upstream 1.7.4 review' }] }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ echoedBytes: body.length, text: body.toString('utf8') }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const root = await mkdtemp(join(tmpdir(), 'deeptutor-web-fetch-test-'));
  const prevFetch = globalThis.fetch;
  const realNodeFetch = prevFetch.bind(globalThis);
  const provider = new DeepTutorWebProvider(
    {
      integration: { registerProvider: async () => {}, pollProvider: () => new Promise(() => {}) },
      aiConfig: { get: async () => ({ config: null, revision: '1', effectiveSelections: [] }) },
    },
    {
      ready: true,
      socket: () => { throw new Error('unused'); },
      request: (path, init) => realNodeFetch(origin + path, init),
    },
    root,
  );

  const prevLocation = globalThis.location;
  const prevDocument = globalThis.document;
  const prevObserver = globalThis.MutationObserver;
  t.after(async () => {
    globalThis.fetch = prevFetch;
    if (prevLocation === undefined) delete globalThis.location; else globalThis.location = prevLocation;
    if (prevDocument === undefined) delete globalThis.document; else globalThis.document = prevDocument;
    if (prevObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = prevObserver;
    await provider.close();
    await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(await readdir(root), []);
    await rmdir(root);
  });

  globalThis.location = new URL('https://deeptutor.nimi.xyz/chat');
  globalThis.document = {
    addEventListener() {},
    removeEventListener() {},
    documentElement: null,
  };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };

  const inspected = await provider.dispatch('web-consumer', 'inspect', {});
  const { id: sessionId } = await provider.dispatch('web-consumer', 'workspace.open', {});
  const channel = new MessageChannel();
  t.after(() => {
    channel.port1.close();
    channel.port2.close();
  });
  channel.port1.onmessage = (msg) => {
    const { id, operation, input } = msg.data;
    void provider
      .dispatch('web-consumer', operation, operation === 'inspect' || operation === 'voices' ? input : { ...input, sessionId })
      .then(
        (result) => channel.port1.postMessage({ id, result }),
        (err) => channel.port1.postMessage({ id, error: String(err) }),
      );
  };
  channel.port1.start();

  const built = await build({
    stdin: {
      contents: `
        import { bindWebWorkspace } from './web/lib/nimi/web-connection.ts';
        import { installBusinessFetch } from './web/lib/nimi/web-business-transport.ts';
        export { bindWebWorkspace, installBusinessFetch };
      `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    alias: { '@': join(process.cwd(), 'web') },
  });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
  mod.bindWebWorkspace(channel.port2, inspected.routes);
  mod.installBusinessFetch();

  const calResp = await fetch('https://deeptutor.nimi.xyz/api/calendar/events');
  assert.equal(calResp.status, 200);
  const calJson = await calResp.json();
  assert.equal(calJson.events[0].id, 'ev-174');

  const bigNote = JSON.stringify({ notebook_id: 'nb-1', title: '笔记', content: '学习内容 '.repeat(25000) });
  const postResp = await fetch('https://deeptutor.nimi.xyz/api/notebooks/actions/add-record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: bigNote,
  });
  assert.equal(postResp.status, 200);
  const postJson = await postResp.json();
  assert.equal(postJson.echoedBytes, Buffer.byteLength(bigNote));
  assert.equal(postJson.text, bigNote);

  const deniedResp = await fetch('https://deeptutor.nimi.xyz/api/settings/providers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(deniedResp.status, 503);
  const deniedBody = await deniedResp.json();
  assert.match(deniedBody.detail, /managed on the PC/);
});
