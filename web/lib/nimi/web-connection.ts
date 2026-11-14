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
  const nativeInput = (event: MouseEvent) => {
    if (ended) return;
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === 'file') {
      event.preventDefault(); event.stopImmediatePropagation();
      const id=crypto.randomUUID(); selectedInput={id,input};
      connection.postMessage({type:'pick-files',id,accept:input.accept,multiple:input.multiple});
      return;
    }
    const anchor=input instanceof Element ? input.closest<HTMLAnchorElement>('a[download]') : null;
    if (!anchor) return;
    const url=new URL(anchor.href,location.origin);
    if (url.origin!==location.origin && !['blob:','data:'].includes(url.protocol)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void (async()=>{
      const response=await apiFetch(url);
      if (!response.ok) throw new Error(`File download failed (HTTP ${response.status}).`);
      const blob=await response.blob();
      await webBusinessCall('client.save-file',{blob,name:anchor.download || decodeURIComponent(url.pathname.split('/').pop() || 'deeptutor-file')});
    })().catch(error=>notify(String(error),{tone:'error'}));
  };
  if (mobile) {
    bindMobileDrafts(mobile.drafts,(key,value)=>{if(!ended)connection.postMessage({type:'draft',key,value});});
    document.addEventListener('click',nativeInput,true);
  }
  port.onmessage = (event) => {
    if (event.data?.ended) {
      ended = true;
      for (const pending of waiting.values())
        pending.reject(new Error('DeepTutor PC connection ended'));
      waiting.clear();
      endMobileDrafts(); document.removeEventListener('click',nativeInput,true); selectedInput=undefined;
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
