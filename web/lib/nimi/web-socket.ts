import { isWebWorkspace, webBusinessCall } from './web-connection';
import { MAX_SOCKET_MESSAGE_BYTES, TRANSFER_CHUNK_BYTES } from '../../../electron/remote-contract';

/** Retains DeepTutor's actual command/event protocol; disconnect never resubmits a command. */
class LearningSocket extends EventTarget {
  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  binaryType: BinaryType = 'blob';
  readyState: number = WebSocket.CONNECTING;
  bufferedAmount = 0;
  onopen: WebSocket['onopen'] = null;
  onerror: WebSocket['onerror'] = null;
  onclose: WebSocket['onclose'] = null;
  onmessage: WebSocket['onmessage'] = null;
  private readonly id = crypto.randomUUID();
  private sequence = 0;
  private readSequence = 0;
  private queue = Promise.resolve();
  constructor(url: string | URL) {
    super(); this.url = String(url); void this.open();
  }
  private emit(event: Event) {
    this.dispatchEvent(event);
    const handler = this[`on${event.type}` as 'onopen'];
    handler?.call(this as unknown as WebSocket, event);
  }
  private async open() {
    try {
      const url = new URL(this.url, location.href);
      if (url.host !== location.host) throw new Error('External learning streams are not allowed');
      await webBusinessCall('socket.open', {id:this.id, path:url.pathname+url.search});
      if (this.readyState === WebSocket.CLOSED) { await webBusinessCall('socket.close',{id:this.id}); return; }
      this.readyState = WebSocket.OPEN; this.emit(new Event('open'));
      while (this.readyState === WebSocket.OPEN) {
        const result = await webBusinessCall<{messages:string[];sequence:number;closed:boolean}>('socket.read',{id:this.id,sequence:this.readSequence});
        if (result.sequence !== this.readSequence+1) throw new Error('Invalid learning event sequence');
        this.readSequence = result.sequence;
        for (const data of result.messages) this.emit(new MessageEvent('message',{data}));
        if (result.closed) { this.close(1006,'PC stream ended'); return; }
        await new Promise(resolve=>setTimeout(resolve,150));
      }
    } catch { if (this.readyState !== WebSocket.CLOSED) { this.emit(new Event('error')); this.close(1006,'Connection ended; review the original learning turn.'); } }
  }
  send(data: string) {
    if (this.readyState !== WebSocket.OPEN || typeof data !== 'string') throw new Error('Learning stream is not open');
    const size = new TextEncoder().encode(data).length;
    if (size > MAX_SOCKET_MESSAGE_BYTES || this.bufferedAmount+size > MAX_SOCKET_MESSAGE_BYTES) throw new Error('Learning command exceeds the 16 MiB worker stream limit');
    this.bufferedAmount += size;
    this.queue = this.queue.then(async()=>{
      let uploadId: string | undefined;
      let consumed = false;
      try {
        if (this.readyState !== WebSocket.OPEN) throw new Error('Learning stream ended');
        const input = { id: this.id, sequence: this.sequence, data };
        let payload: typeof input | { id: string; sequence: number; uploadId: string } = input;
        // Count the actual JSON envelope, including escaped original command
        // strings; keep room for the parent-owned sessionId before admission.
        if (new TextEncoder().encode(JSON.stringify(input)).length > 128 * 1024) {
          const bytes = new TextEncoder().encode(data);
          uploadId = (await webBusinessCall<{ id: string }>('upload', { action: 'begin', size: bytes.length })).id;
          for (let offset = 0; offset < bytes.length; offset += TRANSFER_CHUNK_BYTES) {
            if (this.readyState !== WebSocket.OPEN) throw new Error('Learning stream ended');
            let raw = '';
            for (const byte of bytes.subarray(offset, offset + TRANSFER_CHUNK_BYTES)) raw += String.fromCharCode(byte);
            await webBusinessCall('upload', { action: 'append', id: uploadId, offset, data: btoa(raw) });
          }
          await webBusinessCall('upload', { action: 'finish', id: uploadId });
          payload = { id: this.id, sequence: this.sequence, uploadId };
        }
        if (this.readyState !== WebSocket.OPEN) throw new Error('Learning stream ended');
        const result = await webBusinessCall<{ sequence: number }>('socket.send', payload);
        consumed = true;
        if (result.sequence !== this.sequence + 1) throw new Error('Learning command acknowledgement lost');
        this.sequence = result.sequence;
      } finally {
        this.bufferedAmount = Math.max(0, this.bufferedAmount - size);
        if (uploadId && !consumed) await webBusinessCall('upload', { action: 'release', id: uploadId }).catch(()=>{});
      }
    }).catch(()=>{this.emit(new Event('error'));this.close(1006,'Command outcome uncertain; inspect the existing turn.');});
  }
  close(code=1000,reason='') {
    if (this.readyState===WebSocket.CLOSED) return;
    this.readyState=WebSocket.CLOSED;
    void this.queue.then(()=>webBusinessCall('socket.close',{id:this.id})).catch(()=>{});
    this.emit(new CloseEvent('close',{code,reason,wasClean:code===1000}));
  }
}
export function createLearningSocket(url:string|URL): WebSocket {
  return isWebWorkspace ? new LearningSocket(url) as unknown as WebSocket : new WebSocket(url);
}
