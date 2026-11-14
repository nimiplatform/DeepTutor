let namespace: string | undefined;
const isRemoteWorkspace = () => process.env.NEXT_PUBLIC_NIMI_CARRIER === 'web';

/** This opaque partition label is data isolation, never authentication or server authorization. */
export function bindBrowserWorkspaceStorage(value: string) {
  if (namespace !== undefined || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid DeepTutor browser workspace binding');
  namespace = value;
}
export function workspaceStorageKey(key: string): string {
  if (!isRemoteWorkspace()) return key;
  if (!namespace) throw new Error('DeepTutor browser workspace is not bound');
  return `deeptutor.web.${namespace}.${key}`;
}
export const workspaceLocalStorage: Pick<Storage, 'getItem'|'setItem'|'removeItem'> = {
  getItem: key => localStorage.getItem(workspaceStorageKey(key)),
  setItem: (key,value) => localStorage.setItem(workspaceStorageKey(key),value),
  removeItem: key => localStorage.removeItem(workspaceStorageKey(key)),
};

export function scopedBrowserStorage(storage: Storage) {
  if (!isRemoteWorkspace()) return storage;
  const prefix=workspaceStorageKey('');
  const keys=()=>Array.from({length:storage.length},(_,index)=>storage.key(index)).filter((key):key is string=>!!key&&key.startsWith(prefix));
  return {get length(){return keys().length;},key:(index:number)=>keys()[index]?.slice(prefix.length)??null,
    getItem:(key:string)=>storage.getItem(prefix+key),setItem:(key:string,value:string)=>storage.setItem(prefix+key,value),removeItem:(key:string)=>storage.removeItem(prefix+key)};
}
