import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import { apiFetch } from '@/shared/api/client';
import { bindMobileDrafts, endMobileDrafts } from '@/shared/storage/mobile-drafts';
import { notify } from '@/lib/notifications';
export const isWebWorkspace = process.env.NEXT_PUBLIC_NIMI_CARRIER === 'web';
export type BusinessRoute = { id: string; method: string; template: string; operation: string; parameters: string[] };
let routes: BusinessRoute[] = [];
export function businessRoute(method: string, path: string) {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin) throw new Error('External requests are not DeepTutor business routes');
  for (const route of routes) {
    if (route.method !== method) continue;
    const expression = new RegExp('^' + route.template.split(/(\{[^}]+\})/).map(part => part.startsWith('{') ? '([^/]+)' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('') + '$');
    const match = expression.exec(url.pathname);
    if (match) return { operation: route.operation, route: route.id, parameters: Object.fromEntries(route.parameters.map((key,index)=>[key, decodeURIComponent(match[index+1])])), query: url.search.slice(1) };
  }
  throw new Error('This action is managed on the PC.');
}
let port: MessagePort | undefined;
let ended = false;
let sequence = 0;
const waiting = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
export function bindWebWorkspace(connection: MessagePort, declaredRoutes: BusinessRoute[], mobile?: { drafts: Record<string, unknown> }) {
  if (port) throw new Error('This workspace is already bound to its original connection');
  port = connection; routes = declaredRoutes;
  let selectedInput: { id: string; input: HTMLInputElement } | undefined;
  const handleWorkspaceClick = (event: MouseEvent) => {
    if (ended) return;
    const target = event.target;
    if (mobile && target instanceof HTMLInputElement && target.type === 'file') {
      event.preventDefault(); event.stopImmediatePropagation();
      const id = crypto.randomUUID(); selectedInput = { id, input: target };
      connection.postMessage({ type: 'pick-files', id, accept: target.accept, multiple: target.multiple });
      return;
    }
    const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor) return;
    let url: URL;
    try { url = new URL(anchor.href, location.origin); } catch { return; }
    const hasDownload = anchor.hasAttribute('download');
    const isBusinessPath = url.origin === location.origin && /^\/(api|files)\//.test(url.pathname) && !/^\/api\/(?:runtime-access\/|auth\/runtime-clients\/)/.test(url.pathname);
    if (mobile && hasDownload && (url.origin === location.origin || ['blob:', 'data:'].includes(url.protocol))) {
      event.preventDefault(); event.stopImmediatePropagation();
      void (async () => {
        const response = await apiFetch(url);
        if (!response.ok) throw new Error(`File download failed (HTTP ${response.status}).`);
        const blob = await response.blob();
        await webBusinessCall('client.save-file', { blob, name: anchor.download || decodeURIComponent(url.pathname.split('/').pop() || 'deeptutor-file') });
      })().catch(error => notify(String(error), { tone: 'error' }));
      return;
    }
    if (!mobile && isBusinessPath) {
      event.preventDefault(); event.stopImmediatePropagation();
      void (async () => {
        const response = await apiFetch(url);
        if (!response.ok) throw new Error(`File download failed (HTTP ${response.status}).`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        if (hasDownload) {
          const temp = document.createElement('a');
          temp.href = blobUrl;
          temp.download = anchor.download || decodeURIComponent(url.pathname.split('/').pop() || 'deeptutor-file');
          document.body.appendChild(temp);
          temp.click();
          temp.remove();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        } else {
          window.open(blobUrl, anchor.target || '_blank', 'noopener');
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        }
      })().catch(error => notify(String(error), { tone: 'error' }));
    }
  };
  if (mobile) {
    bindMobileDrafts(mobile.drafts, (key, value) => { if (!ended) connection.postMessage({ type: 'draft', key, value }); });
  }
  document.addEventListener('click', handleWorkspaceClick, true);
  port.onmessage = (event) => {
    if (event.data?.ended) {
      ended = true;
      for (const pending of waiting.values())
        pending.reject(new Error('DeepTutor PC connection ended'));
      waiting.clear();
      endMobileDrafts(); document.removeEventListener('click', handleWorkspaceClick, true); selectedInput = undefined;
      port?.close();
      return;
    }
    if(event.data?.type==='selected-files') {
      const selection=selectedInput;
      if(!selection || selection.id!==event.data.id || !selection.input.isConnected){connection.postMessage({type:'file-accepted',id:event.data.id,error:'Reopen the intended attachment or upload action to use your retained files.'});return;}
      const transfer=new DataTransfer(); for(const file of event.data.files)transfer.items.add(file);
      selection.input.files=transfer.files; selectedInput=undefined;
      selection.input.dispatchEvent(new Event('change',{bubbles:true}));
      connection.postMessage({type:'file-accepted',id:event.data.id});return;
    }
    const pending = waiting.get(event.data?.id);
    if (!pending) return;
    waiting.delete(event.data.id);
    if (event.data.error) pending.reject(new Error(event.data.error));
    else pending.resolve(event.data.result);
  };
  port.start();
}
export function rememberWorkspaceRoute(route:string) { if(!ended)port?.postMessage({type:'route',route}); }
export function webBusinessCall<T>(operation: string, input: unknown): Promise<T> {
  if (!port || ended) return Promise.reject(new Error('DeepTutor PC connection unavailable'));
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    port!.postMessage({ id, operation, input });
  });
}
export async function readWebWorkspace() {
  return webBusinessCall<{ stage: string; configuration: NimiAIConfigSnapshot }>('inspect', {});
}
