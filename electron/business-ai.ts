import type { Duplex } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  collectNimiTextStream, createNimiLocalAppTextModel,
  type NimiGenerateTextRequest,
} from '@nimiplatform/sdk/ai';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const encode = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? Array.from(item) : item) + '\n';

/** App business requests only. No method names, credentials, owner selectors,
 * Runtime endpoints or tool execution cross this private child pipe. */
export class DeepTutorBusinessAI {
  generation = 1;
  private pipe: Duplex | undefined;
  private readonly active = new Map<string, AbortController>();
  constructor(private readonly services: NimiElectronAppBusinessServices, private readonly failureDirectory?: string) {}

  attach(pipe: Duplex): void {
    this.pipe = pipe;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffered = '';
    pipe.on('data', (chunk: Buffer) => {
      try {
        buffered += decoder.decode(chunk, { stream: true });
        if (Buffer.byteLength(buffered, 'utf8') > MAX_FRAME_BYTES) throw new Error('Business request exceeds the frame limit.');
        let newline: number;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          const frame = JSON.parse(line);
          if (frame.v !== 1 || typeof frame.id !== 'string' || frame.id.length > 80) throw new Error('Invalid business envelope.');
          if (frame.kind === 'cancel') {
            if (frame.generation === this.generation) this.active.get(frame.id)?.abort();
          } else if (frame.kind === 'request') {
            void this.request(frame);
          } else throw new Error('Unknown business envelope.');
        }
      } catch (error) {
        this.invalidate();
        pipe.destroy(error instanceof Error ? error : new Error('Invalid business stream.'));
      }
    });
    pipe.on('error', () => this.invalidate());
    pipe.on('close', () => this.invalidate());
  }

  invalidate(): void {
    this.generation += 1;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.send({ v: 1, kind: 'scope-invalidated', generation: this.generation });
  }

  private send(value: unknown): void {
    if (this.pipe && !this.pipe.destroyed && this.pipe.writable) this.pipe.write(encode(value), 'utf8');
  }

  private async request(frame: { id: string; generation: number; operation: string; input: unknown }): Promise<void> {
    const controller = new AbortController();
    const eventTypes: Record<string, number> = {};
    let lastEvent: unknown;
    const { id, generation } = frame;
    const emit = (kind: string, value: unknown) => this.send({ v: 1, id, generation, kind, value });
    const guard = () => {
      controller.signal.throwIfAborted();
      if (generation !== this.generation) throw new Error('NIMI_SESSION_CHANGED: start a new learning turn.');
    };
    try {
      guard();
      if (this.active.has(id) || this.active.size >= 32) throw new Error('Invalid or excessive concurrent business requests.');
      this.active.set(id, controller);
      if (frame.operation === 'text.step') {
        const input = frame.input as NimiGenerateTextRequest;
        // The pipe uses JSON bytes; the public model binding uses Uint8Array.
        const messages = input.messages.map((message) => ({ ...message,
          ...(message.turnItems ? { turnItems: message.turnItems.map((item) =>
            item.type === 'output' && item.output.type === 'reasoning-continuity'
              ? { ...item, output: { ...item.output, carrier: { ...item.output.carrier,
                payload: new Uint8Array(item.output.carrier.payload) } } } : item) } : {}),
        }));
        const model = createNimiLocalAppTextModel(this.services.ai);
        const stream = await model.streamText!({ ...input, messages, signal: controller.signal });
        async function* observe() {
          for await (const event of stream) {
            guard();
            eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
            lastEvent = event;
            if (event.type === 'text-delta') emit('delta', { text: event.text });
            yield event;
          }
        }
        const result = await collectNimiTextStream(observe());
        guard();
        if (!['stop', 'tool-calls', 'length'].includes(result.finishReason)
          || (result.finishReason === 'length' && result.toolCalls?.length)) {
          throw new Error(`DEEPTUTOR_MODEL_INCOMPLETE: ${result.finishReason}`);
        }
        emit('result', { text: result.text, finishReason: result.finishReason,
          outputItems: result.outputItems, toolCalls: result.toolCalls ?? [] });
      } else if (frame.operation === 'embedding.batch') {
        const input = frame.input as { inputs?: unknown };
        if (!input || Object.keys(input).some((key) => key !== 'inputs') || !Array.isArray(input.inputs)
          || input.inputs.some((item) => typeof item !== 'string')) throw new Error('Invalid embedding business input.');
        const result = await this.services.ai.scenario.execute({ type: 'text-embed', inputs: input.inputs });
        guard(); // Sync embedding cannot abort its active Runtime request; discard late results.
        if (result.output.type !== 'text-embed') throw new Error('Unexpected embedding output.');
        emit('result', result.output);
      } else {
        throw new Error('Unsupported DeepTutor business operation.');
      }
    } catch (error) {
      const failure = error as { message?: string; reasonCode?: string; actionHint?: string; traceId?: string; interruption?: unknown };
      emit('error', { message: failure.message ?? String(error),
        reasonCode: failure.reasonCode ?? (controller.signal.aborted ? 'DEEPTUTOR_REQUEST_CANCELLED' : 'DEEPTUTOR_AI_REQUEST_FAILED'),
        actionHint: failure.actionHint, traceId: failure.traceId, interruption: failure.interruption });
      if (this.failureDirectory && frame.operation === 'text.step' && !controller.signal.aborted) {
        const diagnostic = JSON.stringify({
          api: 'createNimiLocalAppTextModel.streamText', input: frame.input,
          eventTypes, lastEvent,
          failure: { message: failure.message, reasonCode: failure.reasonCode,
            actionHint: failure.actionHint, traceId: failure.traceId },
        }, (key, value) => {
          if (key === 'carrier' && value?.payload) {
            const bytes = Buffer.from(value.payload);
            return { kind: value.kind, version: value.version, payloadRedacted: true,
              bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
          }
          return value instanceof Uint8Array ? Array.from(value) : value;
        }, 2);
        if (Buffer.byteLength(diagnostic, 'utf8') <= 4 * 1024 * 1024) {
          try {
            await mkdir(this.failureDirectory, { recursive: true, mode: 0o700 });
            await writeFile(path.join(this.failureDirectory, `${randomUUID()}.json`), diagnostic, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          } catch { console.warn('DeepTutor could not write the opted-in model failure diagnostic.'); }
        }
      }
    } finally {
      if (this.active.get(id) === controller) this.active.delete(id);
    }
  }
}
