import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

export class RedirectError extends Error {
  readonly destination: string;
  constructor(destination: string) {
    super(`NEXT_REDIRECT:${destination}`);
    this.name = 'RedirectError';
    this.destination = destination;
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('NEXT_NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export function redirect(url: string): never {
  throw new RedirectError(url);
}

export function permanentRedirect(url: string): never {
  throw new RedirectError(url);
}

export function notFound(): never {
  throw new NotFoundError();
}

type LocationSnapshot = {
  pathname: string;
  search: string;
  hash: string;
};

let currentSnapshot: LocationSnapshot = {
  pathname: typeof window !== 'undefined' ? window.location.pathname || '/' : '/',
  search: typeof window !== 'undefined' ? window.location.search || '' : '',
  hash: typeof window !== 'undefined' ? window.location.hash || '' : '',
};

const listeners = new Set<() => void>();
let historyPatched = false;

function readLocation(): LocationSnapshot {
  if (typeof window === 'undefined') return currentSnapshot;
  const pathname = window.location.pathname || '/';
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  if (
    currentSnapshot.pathname !== pathname ||
    currentSnapshot.search !== search ||
    currentSnapshot.hash !== hash
  ) {
    currentSnapshot = { pathname, search, hash };
  }
  return currentSnapshot;
}

function notifyLocationChanged() {
  const prev = currentSnapshot;
  const next = readLocation();
  if (prev !== next) {
    for (const listener of listeners) listener();
  }
}

function ensureHistoryListeners() {
  if (historyPatched || typeof window === 'undefined') return;
  historyPatched = true;
  window.addEventListener('popstate', notifyLocationChanged);
  window.addEventListener('hashchange', notifyLocationChanged);
  const rawPush = window.history.pushState.bind(window.history);
  const rawReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = function patchedPushState(...args) {
    rawPush(...args);
    queueMicrotask(notifyLocationChanged);
  };
  window.history.replaceState = function patchedReplaceState(...args) {
    rawReplace(...args);
    queueMicrotask(notifyLocationChanged);
  };
}

function subscribe(listener: () => void) {
  ensureHistoryListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface NavigateOptions {
  scroll?: boolean;
}

export function navigateClient(href: string, mode: 'push' | 'replace', options?: NavigateOptions) {
  if (typeof window === 'undefined') return;
  ensureHistoryListeners();
  const resolved = new URL(href, window.location.origin);
  if (resolved.origin !== window.location.origin) {
    if (mode === 'replace') window.location.replace(resolved.href);
    else window.location.assign(resolved.href);
    return;
  }
  const nextUrl = resolved.pathname + resolved.search + resolved.hash;
  if (mode === 'replace') {
    window.history.replaceState(null, '', nextUrl);
  } else {
    window.history.pushState(null, '', nextUrl);
  }
  notifyLocationChanged();
  if (options?.scroll !== false && !resolved.hash) {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => readLocation().pathname, () => '/');
}

export type ReadonlyURLSearchParams = URLSearchParams;

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => readLocation().search, () => '');
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useRouter() {
  return useMemo(
    () => ({
      push: (href: string, options?: NavigateOptions) => navigateClient(href, 'push', options),
      replace: (href: string, options?: NavigateOptions) => navigateClient(href, 'replace', options),
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      refresh: () => notifyLocationChanged(),
      prefetch: async (_href: string) => {},
    }),
    [],
  );
}

export type RouteParams = Record<string, string | string[]>;

export const RouteParamsContext = createContext<RouteParams>({});

export function useParams<T extends RouteParams = RouteParams>(): T {
  return useContext(RouteParamsContext) as T;
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    ensureHistoryListeners();
  }, []);
  return <>{children}</>;
}
