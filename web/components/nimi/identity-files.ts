/** OS-selected files belong to identity, while delivery belongs to a captured document scope. */
export class IdentityFiles {
  namespace = ''; route = '/'; drafts: Record<string, unknown> = {}; files: File[] = [];
  delivering = false; notice = '';
  private recipient?: { id: string; signal: AbortSignal; send(value: unknown): void };
  constructor(readonly signal: AbortSignal, private changed: () => void) {
    signal.addEventListener('abort', () => { this.files = []; this.drafts = {}; this.recipient = undefined; this.delivering=false; this.notice=''; }, { once: true });
  }
  bind(namespace: string) {
    if (this.namespace && this.namespace !== namespace) { this.files = []; this.drafts = {}; this.route = '/'; this.recipient = undefined; this.delivering=false; this.notice=''; }
    this.namespace = namespace;
  }
  request(id: string, signal: AbortSignal, send: (value: unknown) => void) {
    this.signal.throwIfAborted(); signal.throwIfAborted();
    const recipient = { id, signal, send }; this.recipient = recipient;
    signal.addEventListener('abort', () => { if (this.recipient === recipient) {
      if(this.delivering)this.notice='The previous file handoff was interrupted. Check the original PC task before submitting it again.';
      this.delivering=false;this.recipient = undefined; this.changed();
    } }, { once: true });
    this.changed();
  }
  selected(files: File[]) { if (!this.signal.aborted) { this.files = files; this.changed(); } }
  canDeliver() { return !this.delivering && this.files.length > 0 && Boolean(this.recipient && !this.recipient.signal.aborted && !this.signal.aborted); }
  deliver() {
    if (!this.canDeliver()) return;
    this.recipient!.send({ type: 'selected-files', id: this.recipient!.id, files: this.files });
    this.delivering=true;this.changed();
  }
  accepted(id:string,error?:string) {
    if(this.recipient?.id!==id)return;
    if(error)this.notice=error;else {this.files=[];this.notice='';}
    this.recipient=undefined;this.delivering=false;this.changed();
  }
  discard() { this.files = []; this.recipient = undefined; this.notice=''; this.delivering=false; this.changed(); }
  setRoute(value: string) {
    const url = new URL(value, 'https://deeptutor.invalid');
    if (url.origin !== 'https://deeptutor.invalid') return;
    // A fresh external-video route starts material preparation. Reconnect to the library instead.
    this.route = url.searchParams.has('video') ? '/' : url.pathname + url.search;
  }
}
