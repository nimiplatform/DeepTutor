import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, Menu, protocol, session, shell, webContents } from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034c
try { configureNimiElectronAppHostProfile(app); }
catch (error) { process.stderr.write(`[deeptutor-host-profile] ${String(error)}\n`); app.exit(78); throw error; }
import { DeepTutorBackend } from './backend.js';
import { DeepTutorRendererServer } from './renderer-server.js';
import { DeepTutorBusinessAI } from './business-ai.js';
const {
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} = await import('@nimiplatform/kit/shell/electron/main');

declare const __NIMI_ELECTRON_PRODUCTION__: boolean;

const APP_ID = 'org.nimiplatform.deeptutor';
const NATIVE_BUNDLE_IDENTIFIER = "ai.nimi.apps.org.nimiplatform.deeptutor";
const IS_PRODUCTION_BUNDLE = typeof __NIMI_ELECTRON_PRODUCTION__ !== 'undefined'
  && __NIMI_ELECTRON_PRODUCTION__;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const developmentRendererUrl = readDevelopmentRendererUrl();
let rendererUrl = developmentRendererUrl;
const allowedRendererUrls: string[] = [];
const backend = new DeepTutorBackend();
const rendererServer = new DeepTutorRendererServer();
let businessAI: DeepTutorBusinessAI | undefined;
let bridge: ReturnType<typeof registerNimiElectronAppBridge> | undefined;

app.setName("DeepTutor");
app.setAppUserModelId(NATIVE_BUNDLE_IDENTIFIER);
Menu.setApplicationMenu(null);
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  const startPackagedRenderer = !rendererUrl;
  if (startPackagedRenderer) rendererUrl = await rendererServer.prepare();
  allowedRendererUrls.push(rendererUrl);
  const failureDirectory = !app.isPackaged && existsSync(path.join(appRoot, '.nimi/local/capture-model-failures'))
    ? path.join(appRoot, '.nimi/local/model-failures') : undefined;
  businessAI = new DeepTutorBusinessAI(failureDirectory);
  bridge = registerNimiElectronAppBridge({
    appId: APP_ID,
    allowedRendererUrls,
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    ipcMain,
    onSessionInvalidated: () => businessAI?.invalidate(),
    onSessionReady: (services) => businessAI?.bind(services),
  });
  // Kit primes its verified technical session on registration. Do not defer
  // that binding until the standalone renderer or Python finishes cold start.
  await Promise.all([
    backend.start(appRoot, rendererUrl, businessAI),
    ...(startPackagedRenderer ? [rendererServer.start()] : []),
  ]);
  await createMainWindow();
  app.on('activate', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) { void createMainWindow(); return; }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}).catch(async (error) => {
  console.error('DeepTutor Host startup failed:', error);
  try {
    const logs = path.join(app.getPath('userData'), 'workspace', 'logs');
    await mkdir(logs, { recursive: true, mode: 0o700 });
    const details = error instanceof Error ? error.stack || error.message : String(error);
    await writeFile(path.join(logs, 'startup-error.log'), `${new Date().toISOString()}\n${details.slice(-16384)}\n`, { mode: 0o600 });
  } catch { console.error('Could not save the startup diagnostic.'); }
  await Promise.allSettled([backend.stop(), rendererServer.stop()]);
  app.quit();
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  businessAI?.invalidate();
  bridge?.unregister();
  void Promise.allSettled([backend.stop(), rendererServer.stop()]).finally(() => {
    quitting = true; app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 360,
    minHeight: 560,
    title: "DeepTutor",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedElectronRendererUrl(url, allowedRendererUrls)) void window.loadURL(url);
    else openWebReference(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) {
      event.preventDefault();
      openWebReference(url);
    }
  });
  await window.loadURL(rendererUrl);
}

function openWebReference(raw: string): void {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    void shell.openExternal(url.href).catch(() => console.warn('Unable to open the web reference.'));
  } catch { /* Malformed or non-web links never reach the OS. */ }
}

function readDevelopmentRendererUrl(): string {
  const flag = '--nimi-dev-renderer-url';
  const prefix = '--nimi-dev-renderer-url=';
  const hasDevelopmentRendererArgument = process.argv.some((value) => value === flag || value.startsWith(prefix));
  if (IS_PRODUCTION_BUNDLE && hasDevelopmentRendererArgument) {
    throw new Error('The production Electron bundle rejects --nimi-dev-renderer-url.');
  }
  if (process.argv.includes(flag)) throw new Error('Nimi development renderer URL is missing.');
  const values = process.argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) return '';
  if (values.length !== 1) throw new Error('Nimi development renderer URL must be singular.');
  const selected = values[0];
  if (!selected) throw new Error('Nimi development renderer URL is missing.');
  const raw = selected.slice(prefix.length);
  const parsed = new URL(raw);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())
    || !parsed.port
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Nimi development renderer URL must be exact loopback.');
  }
  return parsed.origin;
}
