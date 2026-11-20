'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { createMobileNimiAppSession } from '@nimiplatform/kit/auth/app/mobile';
import { IdentityFiles } from './identity-files';
import { saveAndroidFile } from '@/lib/nimi/android-file';
import { createWebNimiAppSession, type NimiRemoteAppConfig } from '@nimiplatform/kit/auth/app/web';
import { NimiAccountControl, NimiAppAccessGate, NimiAppSessionProvider, useNimiAppSession, type NimiAppScope } from '@nimiplatform/kit/auth/app';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { bindWebWorkspace, rememberWorkspaceRoute } from '@/lib/nimi/web-connection';
import { bindBrowserWorkspaceStorage } from '@/shared/storage/web-workspace';
import { installBusinessFetch } from '@/lib/nimi/web-business-transport';
import { INTEGRATION_ID } from '../../../electron/remote-contract';
import './web.css';

declare const __NIMI_APP_WEB_CONFIG__: NimiRemoteAppConfig | undefined;

const BusinessShell = lazy(() => import('./BusinessShell'));

function Workspace({
  scope,
  kind,
  files,
  choose,
  save,
}: {
  scope: NimiAppScope;
  kind: 'web' | 'android';
  files: IdentityFiles;
  choose(accept: string, multiple: boolean): void;
  save(blob: Blob, name: string): Promise<void>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [initialRoute, setInitialRoute] = useState('/');

  useEffect(() => {
    const control = new AbortController();
    const signal = AbortSignal.any([scope.signal, control.signal]);
    let port: MessagePort | undefined;
    let target = '';
    let sessionId = '';
    let namespace = '';
    let routes: unknown;
    let routeToOpen = '/';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let documentControl: AbortController | undefined;

    const invoke = async (operation: string, input: unknown) => {
      signal.throwIfAborted();
      const deadline = Date.now() + 70000;
      let call = await scope.client.integration.invoke({
        targetRef: target,
        operation,
        inputJson: JSON.stringify(input),
      });
      while (call.status === 'accepted') {
        signal.throwIfAborted();
        if (Date.now() > deadline) {
          throw new Error('Connection timed out. Check the existing task before trying another action.');
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
        call = await scope.client.integration.getCall({ callId: call.callId });
      }
      signal.throwIfAborted();
      if (call.status !== 'completed') throw new Error(call.errorCode || call.status);
      return JSON.parse(call.resultJson);
    };

    const receive = (event: MessageEvent) => {
      if (
        signal.aborted ||
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data !== 'deeptutor-workspace-ready' ||
        !sessionId
      ) {
        return;
      }
      documentControl?.abort();
      documentControl = new AbortController();
      const documentSignal = AbortSignal.any([signal, documentControl.signal]);
      port?.postMessage({ ended: true });
      port?.close();
      const channel = new MessageChannel();
      const captured = channel.port1;
      port = captured;
      captured.onmessage = (message) => {
        if (documentSignal.aborted) return;
        const data = message.data;
        if (data.type === 'route' && typeof data.route === 'string') {
          files.setRoute(data.route);
          routeToOpen = data.route;
          return;
        }
        if (data.type === 'file-accepted' && typeof data.id === 'string') {
          files.accepted(data.id, data.error);
          return;
        }
        if (kind === 'android' && data.type === 'draft' && typeof data.key === 'string') {
          files.drafts[data.key] = data.value;
          return;
        }
        if (
          kind === 'android' &&
          data.type === 'pick-files' &&
          typeof data.id === 'string' &&
          typeof data.accept === 'string'
        ) {
          files.request(data.id, documentSignal, (value) => captured.postMessage(value));
          if (!files.files.length) choose(data.accept, data.multiple === true);
          return;
        }
        const { id, operation, input } = data;
        const result =
          kind === 'android' && operation === 'client.save-file'
            ? input?.blob instanceof Blob && typeof input.name === 'string'
              ? save(input.blob, input.name)
              : Promise.reject(new Error('Invalid learning file'))
            : invoke(operation, operation === 'inspect' || operation === 'voices' ? input : { ...input, sessionId });
        void result.then(
          (value) => {
            if (!signal.aborted) captured.postMessage({ id, result: value });
          },
          (cause) => {
            captured.postMessage({ id, error: String(cause) });
          },
        );
      };
      captured.start();
      frame.current!.contentWindow!.postMessage(
        {
          type: 'deeptutor-workspace-connect',
          namespace,
          routes,
          kind,
          drafts: files.drafts,
          initialRoute: routeToOpen,
        },
        location.origin,
        [channel.port2],
      );
    };

    window.addEventListener('message', receive);
    void (async () => {
      try {
        const catalog = await scope.client.integration.listCatalog();
        const matches = catalog.filter(
          (item) =>
            item.integrationId === INTEGRATION_ID &&
            item.available &&
            item.permittedOperations.includes('workspace.open') &&
            item.permittedOperations.includes('inspect'),
        );
        if (matches.length !== 1) {
          throw new Error('Open DeepTutor on your PC, then allow this App source in Nimi Home → Integrations.');
        }
        target = matches[0].targetRef;
        const inspected = await invoke('inspect', {});
        if (inspected.stage !== 'ready') throw new Error('The PC learning workspace is still starting.');
        routes = inspected.routes;
        if (!/^[a-f0-9]{64}$/.test(inspected.browserStorageNamespace)) {
          throw new Error('Invalid workspace identity');
        }
        namespace = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(inspected.browserStorageNamespace + '\0' + target),
            ),
          ),
          (x) => x.toString(16).padStart(2, '0'),
        ).join('');
        files.bind(namespace);
        routeToOpen = files.route || '/';
        setInitialRoute(routeToOpen);
        sessionId = (await invoke('workspace.open', {})).id;
        signal.throwIfAborted();
        setReady(true);
        setError('');
        const inspect = async () => {
          try {
            if ((await invoke('inspect', {})).stage !== 'ready') throw new Error('PC workspace unavailable');
          } catch (cause) {
            if (!signal.aborted) {
              documentControl?.abort();
              setError(String(cause));
              setReady(false);
              port?.postMessage({ ended: true });
              port?.close();
            }
          }
          if (!signal.aborted) timer = setTimeout(() => void inspect(), 10000);
        };
        timer = setTimeout(() => void inspect(), 10000);
      } catch (cause) {
        if (!signal.aborted) setError(String(cause));
      }
    })();

    return () => {
      if (sessionId && !scope.signal.aborted) {
        void scope.client.integration
          .invoke({ targetRef: target, operation: 'workspace.close', inputJson: JSON.stringify({ id: sessionId }) })
          .catch(() => {});
      }
      control.abort();
      documentControl?.abort();
      port?.postMessage({ ended: true });
      port?.close();
      if (timer) clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
  }, [scope, attempt, kind, files, choose, save]);

  return (
    <section className="dt-web-workspace">
      {error && (
        <div role="alert" className="dt-web-error">
          <p>{error}</p>
          <button
            onClick={() => {
              setReady(false);
              setAttempt((n) => n + 1);
            }}
          >
            Reconnect workspace
          </button>
          <p>Saved learning tasks remain on your PC. Reconnecting does not submit them again.</p>
        </div>
      )}
      {!ready && !error && <p role="status">Opening your PC learning workspace…</p>}
      {ready && (
        <iframe
          ref={frame}
          key={attempt}
          src={`/?__dt_workspace=${encodeURIComponent(initialRoute)}`}
          title="DeepTutor learning workspace"
          allow="microphone; clipboard-read; clipboard-write"
        />
      )}
    </section>
  );
}

function IdentityWorkspace({ kind, signal }: { kind: 'web' | 'android'; signal: AbortSignal }) {
  const input = useRef<HTMLInputElement>(null);
  const [, update] = useState(0);
  const [files] = useState(() => new IdentityFiles(signal, () => update((n) => n + 1)));
  const [delivery, setDelivery] = useState('');
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [choose] = useState(
    () => (accept: string, multiple: boolean) => {
      if (input.current) {
        input.current.accept = accept;
        input.current.multiple = multiple;
        input.current.click();
      }
    },
  );
  const [save] = useState(
    () => async (blob: Blob, name: string) => {
      setDelivery(`Preparing ${name} for Android Save…`);
      setDeliveryBusy(true);
      try {
        const savedName = await saveAndroidFile(blob, name, signal);
        if (!signal.aborted) setDelivery(savedName ? `Saved ${savedName}.` : 'File saved.');
      } catch (error) {
        if (!signal.aborted) setDelivery(String(error));
        throw error;
      } finally {
        if (!signal.aborted) setDeliveryBusy(false);
      }
    },
  );
  return (
    <>
      {kind === 'android' && (
        <input
          ref={input}
          type="file"
          hidden
          aria-label="Select learning files"
          onChange={(event) => {
            files.selected(Array.from(event.currentTarget.files || []));
            event.currentTarget.value = '';
          }}
        />
      )}
      {files.files.length > 0 && (
        <section className="dt-mobile-files" aria-live="polite">
          <strong>{files.files.map((file) => file.name).join(', ')}</strong>
          <p>
            {files.notice ||
              (files.canDeliver()
                ? 'Use these files for the attachment or upload action you opened.'
                : 'Your files are retained. Reconnect and reopen the intended attachment or upload action. Unfinished work was not replayed.')}
          </p>
          <button disabled={!files.canDeliver()} onClick={() => files.deliver()}>
            Use selected files
          </button>
          <button disabled={files.delivering} onClick={() => files.discard()}>
            Discard selection
          </button>
        </section>
      )}
      {delivery && (
        <div className="dt-mobile-files dt-file-status" role="status">
          <p>{delivery}</p>
          {!deliveryBusy && (
            <button aria-label="Dismiss file message" onClick={() => setDelivery('')}>
              Close
            </button>
          )}
        </div>
      )}
      <NimiAppAccessGate externalAccountControl title="DeepTutor" language="en">
        {(scope) => <Workspace key={scope.viewKey} scope={scope} kind={kind} files={files} choose={choose} save={save} />}
      </NimiAppAccessGate>
    </>
  );
}

function RemoteShell({ kind }: { kind: 'web' | 'android' }) {
  const { snapshot } = useNimiAppSession();
  const identity = snapshot.identity.status === 'signed-in' ? snapshot.identity : null;
  return (
    <div className="dt-web-shell">
      <header>
        <div>
          <strong>DeepTutor</strong>
          <p>Study, write and continue your PC learning tasks.</p>
        </div>
        {identity && (
          <details className="dt-account">
            <summary>{identity.user?.displayName || 'Nimi account'}</summary>
            <div>
              <NimiAccountControl hideSignedOut language="en" />
            </div>
          </details>
        )}
      </header>
      <NimiAppAccessGate externalAccountControl title="DeepTutor" language="en" requireRuntime={false}>
        {identity && <IdentityWorkspace key={identity.viewKey} kind={kind} signal={identity.signal} />}
      </NimiAppAccessGate>
    </div>
  );
}

let documentSession: ReturnType<typeof createWebNimiAppSession> | undefined;

function readWebConfig(): NimiRemoteAppConfig {
  if (typeof __NIMI_APP_WEB_CONFIG__ !== 'undefined' && __NIMI_APP_WEB_CONFIG__) {
    return __NIMI_APP_WEB_CONFIG__;
  }
  const envConfig = process.env.NEXT_PUBLIC_NIMI_WEB_CONFIG;
  if (envConfig) {
    return JSON.parse(envConfig) as NimiRemoteAppConfig;
  }
  throw new Error('Missing Nimi Web configuration.');
}

function getDocumentSession() {
  if (!documentSession) {
    const mobile = Capacitor.getPlatform() === 'android';
    if (mobile) {
      const config = process.env.NEXT_PUBLIC_NIMI_MOBILE_CONFIG;
      if (!config) {
        throw new Error('This Android development App requires the configured local editor service.');
      }
      documentSession = createMobileNimiAppSession(JSON.parse(config));
    } else {
      documentSession = createWebNimiAppSession(readWebConfig());
    }
  }
  return documentSession;
}

function WebEntry() {
  const [session] = useState(getDocumentSession);
  // Document identity survives React development effect replay; the carrier owns background scope ending.
  useEffect(() => {
    void session.start();
  }, [session]);
  return (
    <NimiThemeProvider accentPack="nimi-accent">
      <TooltipProvider>
        <NimiAppSessionProvider session={session}>
          <RemoteShell kind={Capacitor.getPlatform() === 'android' ? 'android' : 'web'} />
        </NimiAppSessionProvider>
      </TooltipProvider>
    </NimiThemeProvider>
  );
}

function RouteMemory() {
  const pathname = usePathname();
  const query = useSearchParams();
  useEffect(() => {
    if (query.has('__dt_workspace')) return;
    rememberWorkspaceRoute(pathname + (query.size ? '?' + query.toString() : ''));
  }, [pathname, query]);
  return null;
}

export default function WebBoundary({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'loading' | 'entry' | 'workspace'>('loading');
  const advertised = useRef(false);
  const bound = useRef(false);

  useEffect(() => {
    if (window === parent) {
      setMode('entry');
      return;
    }
    const receive = (event: MessageEvent) => {
      if (
        bound.current ||
        event.origin !== location.origin ||
        event.source !== parent ||
        event.data?.type !== 'deeptutor-workspace-connect' ||
        !event.ports[0]
      ) {
        return;
      }
      const targetRoute =
        typeof event.data.initialRoute === 'string' && event.data.initialRoute.startsWith('/')
          ? event.data.initialRoute
          : '/';
      window.history.replaceState(null, '', targetRoute);
      window.dispatchEvent(new PopStateEvent('popstate'));
      bindBrowserWorkspaceStorage(event.data.namespace);
      bindWebWorkspace(
        event.ports[0],
        event.data.routes,
        event.data.kind === 'android' ? { drafts: event.data.drafts } : undefined,
      );
      installBusinessFetch();
      bound.current = true;
      setMode('workspace');
    };
    window.addEventListener('message', receive);
    if (!advertised.current) {
      advertised.current = true;
      parent.postMessage('deeptutor-workspace-ready', location.origin);
    }
    return () => window.removeEventListener('message', receive);
  }, []);

  return mode === 'entry' ? (
    <WebEntry />
  ) : mode === 'workspace' ? (
    <Suspense fallback={<p>Loading learning workspace…</p>}>
      <BusinessShell>
        <RouteMemory />
        {children}
      </BusinessShell>
    </Suspense>
  ) : (
    <p role="status">Connecting DeepTutor…</p>
  );
}
