// @nimi-authority: rule.nimi.sdks.feature-clients.integrations
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, appendFile, open, rm, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import type { DeepTutorBackend } from './backend.js';
import { resolveBusinessRoute, routeDescriptors, businessRoutes, remoteHeaders, responseHeaders } from './remote-policy.js';
import WebSocket from 'ws';
import {
  INTEGRATION_ID,
  MAX_TRANSFER_BYTES,
  MAX_SOCKET_MESSAGE_BYTES,
  TRANSFER_CHUNK_BYTES,
  RESULT_CHUNK_BYTES,
  type BusinessResponse,
} from './remote-contract.js';

type Upload = {
  owner: string;
  file: string;
  size: number;
  received: number;
  complete: boolean;
  inUse?: boolean;
};
type RequestRecord = {
  owner: string;
  file: string;
  size: number;
  state: BusinessResponse['state'];
  status?: number;
  headers?: Record<string, string>;
  control: AbortController;
  work: Promise<void>;
  error?: string;
};
type SocketRecord = {
  owner: string;
  socket: WebSocket;
  messages: string[];
  bytes: number;
  sequence: number;
  readSequence: number;
  closed: boolean;
};
const object = (properties: Record<string, unknown>, required: string[] = []) =>
  JSON.stringify({ type: 'object', additionalProperties: false, properties, required });
const id = { type: 'string', minLength: 8, maxLength: 80, pattern: '^[A-Za-z0-9-]+$' };
const number = { type: 'integer', minimum: 0, maximum: MAX_TRANSFER_BYTES };
const operation = (
  name: string,
  effect: string,
  properties: Record<string, unknown>,
  required: string[],
  description: string,
  alternatives?: readonly object[],
) => ({
  name,
  displayName: name,
  effect,
  inputSchemaJson: JSON.stringify({ ...JSON.parse(object(properties, required)), ...(alternatives ? { oneOf: alternatives } : {}) }),
  outputSchemaJson: object({}, []).replace(
    '"additionalProperties":false',
    '"additionalProperties":true',
  ),
  description,
  supportsCancel: false,
  retryPolicy: 'none',
});

/** A permission to this provider grants the existing PC DeepTutor workspace, including edits.
 * Transfer objects are caller-bound. No Host credential, arbitrary URL or Runtime method is exposed.
 */
export class DeepTutorWebProvider {
  private uploads = new Map<string, Upload>();
  private requests = new Map<string, RequestRecord>();
  private responseBytes = 0;
  private sockets = new Map<string, SocketRecord>();
  private closed = false;
  private sessions = new Map<string, { owner: string; cookie?: string }>();
  private activeCall: Promise<unknown> | undefined;
  private polling: Promise<void>;
  error = '';
  constructor(
    private services: NimiElectronAppBusinessServices,
    private backend: DeepTutorBackend,
    private root: string,
  ) {
    this.polling = this.run();
  }
  private async run() {
    try {
      await mkdir(this.root, { recursive: true });
      await this.services.integration.registerProvider({
        integrationId: INTEGRATION_ID,
        displayName: 'DeepTutor PC workspace',
        skill: 'Use the existing PC DeepTutor learning workspace. Read grants expose its records; manage grants edit the same records and can run learning tasks using the PC App AI configuration. Machine setup stays on the PC. Credentials stay in the PC Host. Each logical session and temporary transfer belongs to the Runtime-verified consumer. Reconnect observes original turns; never automatically replay work.',
        operations: [
          operation(
            'inspect',
            'read',
            {},
            [],
            'Read actual business worker readiness and PC App AI configuration.',
          ),
          operation(
            'upload',
            'write',
            {
              action: { type: 'string', enum: ['begin', 'append', 'finish', 'release'] }, sessionId: id,
              id,
              size: number,
              offset: number,
              data: { type: 'string', maxLength: 87384 },
            },
            ['action', 'sessionId'],
            'Transfer a business request body up to 512 MiB in ordered 64 KiB chunks.',
          ),
          ...routeDescriptors,
          operation('workspace.open','write',{},[], 'Open a caller-bound DeepTutor business session. Its optional business login remains on the PC.'),
          operation('workspace.close','write',{ id },['id'], 'Close this business session and its transport. Saved learning turns and records are not deleted.'),
          operation('voices','read',{},[], 'Read preset voices available to the PC DeepTutor configuration.'),
          operation(
            'request.read',
            'read',
            { sessionId: id, id, offset: number },
            ['sessionId', 'id', 'offset'],
            'Read the original request status and up to 128 KiB of its actual response. Unknown is never success.',
          ),
          operation(
            'request.stop',
            'write',
            { sessionId: id, id },
            ['sessionId', 'id'],
            'Abort this caller’s request. Worker disconnect cancels the attached inference; independently admitted business Jobs keep their explicit cancel action.',
          ),
          operation(
            'request.release',
            'write',
            { sessionId: id, id },
            ['sessionId', 'id'],
            'Release delivered temporary response bytes without deleting voices, projects or output files.',
          ),
          operation('socket.open','write', {sessionId:id,id,path:{type:'string',maxLength:4096}}, ['sessionId','id','path'], 'Open an existing DeepTutor learning, book, knowledge, mastery or partner stream.'),
          operation('socket.send','write', {sessionId:id,id,sequence:number,data:{type:'string',maxLength:196608},uploadId:id}, ['sessionId','id','sequence'], 'Send one original DeepTutor text command exactly once, up to the existing 16 MiB worker limit. Supply exactly one payload: inline data or a complete caller/session-owned uploadId. Uploaded bytes are consumed and released once; duplicate sequence numbers are refused.', [{required:['data'],not:{required:['uploadId']}},{required:['uploadId'],not:{required:['data']}}]),
          operation('socket.read','read', {sessionId:id,id,sequence:number}, ['sessionId','id','sequence'], 'Read ordered actual DeepTutor stream messages.'),
          operation('socket.close','write', {sessionId:id,id}, ['sessionId','id'], 'Close only this transport; durable learning turns retain their own cancel command.'),
        ],
      });
      while (!this.closed) {
        const batch = await this.services.integration.pollProvider({ waitMs: 25000 });
        for (const call of batch.calls) {
          if (this.closed) return;
          let resultJson = '{}',
            errorCode = '';
          try {
            this.activeCall = this.dispatch(
              call.consumerRef,
              call.operation,
              JSON.parse(call.inputJson),
            );
            resultJson = JSON.stringify(await this.activeCall);
          } catch (cause) {
            errorCode = 'DEEPTUTOR_BUSINESS_FAILED';
            this.error = cause instanceof Error ? cause.message : String(cause);
            resultJson = JSON.stringify({ error: this.error });
          } finally {
            this.activeCall = undefined;
          }
          if (!this.closed) {
            try {
              await this.services.integration.completeProvider({
                callId: call.callId,
                resultJson,
                errorCode,
              });
            } catch (cause) {
              this.error =
                String(cause); /* An uncertain delivery never repeats the business operation. */
            }
          }
        }
      }
    } catch (cause) {
      if (!this.closed) this.error = String(cause);
    }
  }
  private owned<T extends { owner: string }>(map: Map<string, T>, owner: string, id: string): T {
    const value = map.get(id);
    if (!value || value.owner !== owner) throw new Error('Unknown DeepTutor transfer');
    return value;
  }
  async dispatch(owner: string, operation: string, input: Record<string, any>): Promise<unknown> {
    if (this.closed || !owner) throw new Error('DeepTutor PC connection ended');
    if (operation === 'inspect')
      return {
        stage: this.backend.ready ? 'ready' : 'starting',
        routes: businessRoutes,
        configuration: await this.services.aiConfig.get(),
        browserStorageNamespace: createHash('sha256').update(owner).digest('hex'),
      };
    if (operation === 'voices') return this.services.aiConfig.listOptions({ kind: 'preset-voices' });
    if (operation === 'workspace.open') {
      if (this.sessions.size >= 64) throw new Error('Close unused DeepTutor browser sessions before opening another.');
      const id = randomUUID(); this.sessions.set(id, { owner }); return { id };
    }
    const business = this.sessions.get(operation === 'workspace.close' ? input.id : input.sessionId);
    if (!business || business.owner !== owner) throw new Error('DeepTutor browser session ended.');
    owner = owner + ':' + (operation === 'workspace.close' ? input.id : input.sessionId);
    if (operation === 'workspace.close') {
      for (const [id, socket] of this.sockets) if (socket.owner === owner) { socket.socket.close(); this.sockets.delete(id); }
      for (const [id, request] of this.requests) if (request.owner === owner) { request.control.abort(); await request.work; await rm(request.file,{force:true}); this.responseBytes -= request.size; this.requests.delete(id); }
      for (const [id, upload] of this.uploads) if (upload.owner === owner) { await rm(upload.file,{force:true}); this.uploads.delete(id); }
      this.sessions.delete(input.id); return { closed: true };
    }
    if (operation === 'upload') {
      if (input.action === 'begin') {
        if (
          !Number.isSafeInteger(input.size) ||
          input.size < 1 ||
          input.size > MAX_TRANSFER_BYTES ||
          this.uploads.size >= 64 ||
          [...this.uploads.values()].reduce((n, v) => n + v.size, 0) + input.size >
            2 * MAX_TRANSFER_BYTES
        )
          throw new Error('DeepTutor transfer capacity exceeded');
        const id = randomUUID();
        this.uploads.set(id, {
          owner,
          file: join(this.root, id),
          size: input.size,
          received: 0,
          complete: false,
        });
        return { id };
      }
      const upload = this.owned(this.uploads, owner, input.id);
      if (input.action === 'release') {
        if (upload.inUse) throw new Error('The request still owns this upload');
        await rm(upload.file, { force: true });
        this.uploads.delete(input.id);
        return { released: true };
      }
      if (input.action === 'finish') {
        if (upload.received !== upload.size) throw new Error('Incomplete upload');
        upload.complete = true;
        return { id: input.id };
      }
      if (input.action !== 'append' || upload.complete || input.offset !== upload.received)
        throw new Error('Invalid upload order');
      const bytes = this.decode(input.data);
      if (upload.received + bytes.length > upload.size)
        throw new Error('Upload exceeds declared size');
      await appendFile(upload.file, bytes);
      upload.received += bytes.length;
      return { received: upload.received };
    }
    if (routeDescriptors.some(item => item.name === operation)) {
      const resolved = resolveBusinessRoute(operation, input.route, input.parameters, input.query);
      const method = resolved.route.method, path = resolved.path;
      input.id = input.requestId;
      input.uploadId = input.bodyId;
      if (!this.backend.ready) throw new Error('DeepTutor PC worker is unavailable');
      if (this.requests.has(input.id) || this.requests.size >= 128)
        throw new Error('Read the original request or release finished transfers');
      const upload = input.uploadId ? this.owned(this.uploads, owner, input.uploadId) : undefined;
      if (upload && (!upload.complete || upload.inUse))
        throw new Error('Finish a new upload for this request');
      const headers: Record<string,string> = {};
      for (const [key, value] of Object.entries(input.headers || {})) {
        if (
          !remoteHeaders.has(key) ||
          typeof value !== 'string' ||
          /[\r\n]/.test(value)
        )
          throw new Error('Unsupported business header');
        headers[key] = value;
      }
      const record: RequestRecord = {
        owner,
        file: join(this.root, randomUUID()),
        size: 0,
        state: 'pending',
        control: new AbortController(),
        work: Promise.resolve(),
      };
      this.requests.set(input.id, record);
      if (upload) upload.inUse = true;
      record.work = (async () => {
        try {
          const response = await this.backend.request(path, {
            method,
            headers,
            body: upload ? (createReadStream(upload.file) as never) : undefined,
            duplex: 'half',
            signal: record.control.signal,
            redirect: 'error',
          } as RequestInit, business.cookie);
          for (const cookie of response.headers.getSetCookie()) {
            const token = /^dt_token=([^;]*)/.exec(cookie);
            if (token) business.cookie = token[1] || undefined;
          }
          if (response.status >= 300 && response.status < 400) throw new Error('Unexpected business redirect');
          record.status = response.status;
          record.headers = {};
          for (const [key, value] of response.headers)
            if (
              responseHeaders.has(key)
            )
              record.headers[key] = value;
          record.state = 'running';
          const reader = response.body?.getReader();
          if (reader)
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) break;
                if (record.size + next.value.length > MAX_TRANSFER_BYTES)
                  throw new Error('Response exceeds 512 MiB transfer limit');
                if (this.responseBytes + next.value.length > 2 * MAX_TRANSFER_BYTES)
                  throw new Error('Release existing response transfers before reading more media');
                this.responseBytes += next.value.length;
                try {
                  await appendFile(record.file, next.value);
                } catch (cause) {
                  this.responseBytes -= next.value.length;
                  throw cause;
                }
                record.size += next.value.length;
              }
            } finally {
              await reader.cancel().catch(() => {});
              reader.releaseLock();
            }
          record.state = 'completed';
        } catch (cause) {
          record.state = record.control.signal.aborted ? 'canceled' : 'failed';
          record.error = cause instanceof Error ? cause.message : String(cause);
        } finally {
          if (upload) {
            this.uploads.delete(input.uploadId);
            await rm(upload.file, { force: true });
          }
        }
      })();
      return { id: input.id };
    }
    if (operation.startsWith('request.')) {
      const record = this.requests.get(input.id);
      if (!record || record.owner !== owner) return { state: 'unknown' };
      if (operation === 'request.stop') {
        record.control.abort();
        await record.work;
        return { state: record.state };
      }
      if (operation === 'request.release') {
        if (['running', 'pending'].includes(record.state))
          throw new Error('Request is still running');
        await record.work;
        await rm(record.file, { force: true });
        this.responseBytes -= record.size;
        this.requests.delete(input.id);
        return { released: true };
      }
      if (
        operation !== 'request.read' ||
        !Number.isSafeInteger(input.offset) ||
        input.offset < 0 ||
        input.offset > record.size
      )
        throw new Error('Invalid response range');
      const state = record.state;
      const size = Math.min(RESULT_CHUNK_BYTES, record.size - input.offset);
      let data = '';
      if (size) {
        const file = await open(record.file, 'r');
        try {
          const bytes = Buffer.alloc(size);
          const read = await file.read(bytes, 0, size, input.offset);
          if (read.bytesRead !== size) throw new Error('Incomplete response range');
          data = bytes.toString('base64');
        } finally {
          await file.close();
        }
      }
      return {
        state,
        status: record.status,
        headers: record.headers,
        offset: input.offset,
        nextOffset: input.offset + size,
        data,
        error: record.error,
      };
    }
    if (operation === 'socket.open') {
      if (this.sockets.has(input.id) || this.sockets.size >= 16)
        throw new Error('DeepTutor socket capacity exceeded');
      const url = new URL(String(input.path), 'http://deeptutor.invalid');
      const allowed = /^\/ws(?:\/(?:books|questions\/judge|mastery-paths)|\/knowledge-bases\/[^/]+\/progress|\/partners\/[^/]+|\/partner-groups\/[^/]+)?$/.test(url.pathname);
      if (url.origin !== 'http://deeptutor.invalid' || !allowed || url.hash || url.search.length > 4096 || /[\\\\]/.test(input.path)) throw new Error('Unknown DeepTutor stream');
      const socket = this.backend.socket(url.pathname + url.search, business.cookie);
      const record: SocketRecord = {
        owner,
        socket,
        messages: [],
        bytes: 0,
        sequence: 0,
        readSequence: 0,
        closed: false,
      };
      this.sockets.set(input.id, record);
      socket.onmessage = (event) => {
        const data = String(event.data);
        if (record.bytes + Buffer.byteLength(JSON.stringify(data)) > 512 * 1024) {
          socket.close();
          record.closed = true;
          return;
        }
        record.messages.push(data);
        record.bytes += Buffer.byteLength(JSON.stringify(data));
      };
      socket.onclose = () => {
        record.closed = true;
      };
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.terminate();
            reject(new Error('DeepTutor channel timed out'));
          }, 10000);
          socket.onopen = () => { clearTimeout(timer); resolve(); };
          socket.onerror = () => { clearTimeout(timer); reject(new Error('DeepTutor channel unavailable')); };
        });
      } catch (error) {
        this.sockets.delete(input.id);
        socket.terminate();
        throw error;
      }
      return { id: input.id };
    }
    if (operation.startsWith('socket.')) {
      const record = this.owned(this.sockets, owner, input.id);
      if (operation === 'socket.close') {
        record.socket.close();
        this.sockets.delete(input.id);
        return { closed: true };
      }
      if (operation === 'socket.send') {
        if (input.sequence !== record.sequence || record.socket.readyState !== WebSocket.OPEN || record.socket.bufferedAmount > 1024*1024) throw new Error('Invalid learning command sequence');
        const upload = input.uploadId ? this.owned(this.uploads, owner, input.uploadId) : undefined;
        if (upload && (!upload.complete || upload.inUse || upload.size > MAX_SOCKET_MESSAGE_BYTES)) throw new Error('Finish a new upload within the learning stream limit.');
        if (upload) upload.inUse = true;
        try {
          const data = upload ? new TextDecoder('utf-8', { fatal: true }).decode(await readFile(upload.file)) : input.data;
          if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_SOCKET_MESSAGE_BYTES) throw new Error('Learning command exceeds the worker stream limit.');
          if (this.closed || record.socket.readyState !== WebSocket.OPEN) throw new Error('DeepTutor channel ended');
          await new Promise<void>((resolve, reject) => record.socket.send(data, error => error ? reject(error) : resolve()));
          record.sequence++;
          return { sequence: record.sequence };
        } finally {
          if (upload) { this.uploads.delete(input.uploadId); await rm(upload.file, { force: true }); }
        }
      }
      if (operation === 'socket.read') {
        if (input.sequence !== record.readSequence) throw new Error('Invalid event sequence');
        const messages = record.messages.splice(0);
        record.bytes = 0;
        record.readSequence++;
        return { messages, closed: record.closed, sequence: record.readSequence };
      }
    }
    throw new Error('Unknown DeepTutor operation');
  }
  private decode(value: unknown) {
    if (
      typeof value !== 'string' ||
      value.length > 87384 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    )
      throw new Error('Invalid transfer chunk');
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length || bytes.length > TRANSFER_CHUNK_BYTES)
      throw new Error('Invalid transfer size');
    return bytes;
  }
  async close() {
    this.closed = true;
    for (const item of this.requests.values()) item.control.abort();
    for (const item of this.sockets.values()) item.socket.close();
    await this.activeCall?.catch(() => {});
    await Promise.all([...this.requests.values()].map((item) => item.work));
    // Only explicitly allocated temporary files; never recursively delete an App workspace.
    for (const item of [...this.requests.values(), ...this.uploads.values()])
      await rm(item.file, { force: true });
    this.requests.clear();
    this.uploads.clear();
    this.sockets.clear();
    this.sessions.clear();
    void this.polling.catch(() => {});
  }
}
