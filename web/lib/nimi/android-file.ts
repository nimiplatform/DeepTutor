import { registerPlugin } from '@capacitor/core';
const files = registerPlugin<{
  beginExport(input:{name:string;mime:string}):Promise<{id:string}>;
  appendExport(input:{id:string;offset:number;data:string}):Promise<{received:number}>;
  saveExport(input:{id:string}):Promise<{bytesWritten:number;name?:string}>;
  abortExport(input:{id:string}):Promise<void>;
}>('DeepTutorFiles');

/** Stage complete App bytes before Android's system Save picker backgrounds Runtime. */
export async function saveAndroidFile(blob: Blob, requestedName: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!blob.size || blob.size > 512 * 1024 * 1024) throw new Error('The file is empty or exceeds the 512 MiB transfer limit.');
  // Match a browser download's filename semantics without changing the App record title.
  const sanitized=requestedName.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'-').trim() || 'deeptutor-file';
  const extension=sanitized.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] || '';
  const name=sanitized.length>180 ? sanitized.slice(0,180-extension.length)+extension : sanitized;
  const {id} = await files.beginExport({name, mime:blob.type || 'application/octet-stream'});
  const reader = blob.stream().getReader(); let offset = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const {done,value} = await reader.read(); if (done) break;
      for (let start=0;start<value.length;start+=65536) {
        const bytes=value.subarray(start,start+65536); let encoded='';
        for (let i=0;i<bytes.length;i+=8192) encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const result=await files.appendExport({id,offset,data:btoa(encoded)}); offset+=bytes.length;
        if (result.received!==offset) throw new Error('The Android file transfer was incomplete.');
      }
    }
    signal.throwIfAborted();
    const saved=await files.saveExport({id});
    if (saved.bytesWritten!==offset) throw new Error('The file was not completely saved.');
    return saved.name;
  } catch (error) { await files.abortExport({id}).catch(()=>{}); throw error; }
  finally { reader.releaseLock(); }
}
