import assert from 'node:assert/strict';
import test from 'node:test';
import { Duplex } from 'node:stream';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['electron/business-ai.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { DeepTutorBusinessAI } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function pair() {
  let host, child;
  host = new Duplex({ read() {}, write(chunk, encoding, done) { child.push(chunk); done(); } });
  child = new Duplex({ read() {}, write(chunk, encoding, done) { host.push(chunk); done(); } });
  return { host, child };
}
function answer(child) { return new Promise(resolve => {
  let buffer = '';
  const read = chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) {
    const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    if (frame.kind === 'result' || frame.kind === 'error') { child.off('data', read); resolve(frame); return; }
  } };
  child.on('data', read);
}); }

test('new ready services restore new business work while invalidated requests stay retired', async () => {
  const { host, child } = pair(); const owner = new DeepTutorBusinessAI(); owner.attach(host);
  const calls = [];
  const services = label => ({ ai: { scenario: { execute: async () => { calls.push(label); return { output: { type: 'text-embed', vectors: [[1]], spaceId: label }, traceId: '' }; } } } });
  const request = async id => { const received = answer(child); child.write(JSON.stringify({ v: 1, id, kind: 'request', generation: owner.generation, operation: 'embedding.batch', input: { inputs: ['text'], purpose: 'retrieval-document' } }) + '\n'); return received; };
  owner.bind(services('old')); assert.equal((await request('one')).value.spaceId, 'old');
  owner.invalidate(); assert.equal((await request('blocked')).kind, 'error');
  owner.bind(services('fresh')); assert.equal((await request('new')).value.spaceId, 'fresh');
  assert.deepEqual(calls, ['old', 'fresh']); host.destroy(); child.destroy();
});

test('embedding stop reaches the in-flight synchronous call signal', async () => {
  const { host, child } = pair(); const owner = new DeepTutorBusinessAI(); owner.attach(host);
  let signal; let entered;
  const began = new Promise(resolve => { entered = resolve; });
  owner.bind({ ai: { scenario: { execute: (_spec, options) => new Promise((_resolve, reject) => { signal = options.signal; signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); entered(); }) } } });
  const received = answer(child);
  child.write(JSON.stringify({ v: 1, id: 'cancel', kind: 'request', generation: owner.generation, operation: 'embedding.batch', input: { inputs: ['text'], purpose: 'retrieval-document' } }) + '\n');
  await began; child.write(JSON.stringify({ v: 1, id: 'cancel', kind: 'cancel', generation: owner.generation }) + '\n');
  assert.equal((await received).kind, 'error'); assert.equal(signal.aborted, true); host.destroy(); child.destroy();
});

test('business text uses installed SDK formal SYNC and opaque pipe replay is reversible', async () => {
  const { host, child } = pair(); const owner = new DeepTutorBusinessAI(); owner.attach(host);
  const requests = [];
  owner.bind({ ai: {
    text: { streamTurn: async () => { throw new Error('The synchronous business step must not open a Runtime stream'); } },
    scenario: { execute: async (spec, options) => {
      requests.push(spec); assert.equal(spec.type, 'text-generate'); assert.ok(options.signal);
      return { output: { type: 'text-generate', finishReason: 'stop', items: [
        { type: 'reasoning-continuity', carrier: { kind: 'test.opaque', version: 1, payload: [0, 255] } },
        { type: 'text', text: '  Answer 中文\n' },
      ] }, traceId: '' };
    } },
  } });
  const request = async (id, messages) => {
    const received = answer(child);
    child.write(JSON.stringify({ v: 1, id, kind: 'request', generation: owner.generation, operation: 'text.step', input: { messages, parameters: {} } }) + '\n');
    return received;
  };
  const first = await request('text-one', [{ role: 'user', content: [{ type: 'text', text: 'Question' }] }]);
  assert.equal(first.kind, 'result'); assert.equal(first.value.text, '  Answer 中文\n');
  assert.equal(first.value.outputItems[0].carrier.payload, 'AP8=');
  const second = await request('text-two', [
    { role: 'user', content: [{ type: 'text', text: 'Question' }] },
    { role: 'assistant', content: [], turnItems: first.value.outputItems.map(output => ({ type: 'output', output })) },
    { role: 'user', content: [{ type: 'text', text: 'Next' }] },
  ]);
  assert.equal(second.kind, 'result'); assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].messages[1].turnItems[0].output.carrier.payload, [0, 255]);
  host.destroy(); child.destroy();
});
