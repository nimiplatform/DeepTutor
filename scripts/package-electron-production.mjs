import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, open, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { build } from 'esbuild';
import { verifyFrozenBackend, verifyNextStandalone } from './verify-next-standalone.mjs';

const APP_EXECUTABLE_NAME = 'deeptutor-shell';
const APP_PRODUCT_NAME = 'DeepTutor';

function resolveWindowsResourceVersion(appVersion) {
  const semverPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
  if (typeof appVersion !== 'string' || !semverPattern.test(appVersion)) {
    throw new Error(`Windows production packaging requires an exact semantic App version: ${String(appVersion)}`);
  }
  const coreComponents = appVersion.split(/[+-]/u, 1)[0].split('.');
  if (coreComponents.some((component) => BigInt(component) > 65535n)) {
    throw new Error(`Windows production packaging requires App version core components in the 0..65535 range: ${appVersion}`);
  }
  return `${coreComponents.join('.')}.0`;
}

const MACOS_BUILD = process.platform === 'darwin' && process.arch === 'arm64';
const NATIVE_PLATFORM = MACOS_BUILD ? 'darwin' : 'win32';
const NATIVE_ARCH = MACOS_BUILD ? 'arm64' : 'x64';
const NATIVE_BINDING_PACKAGE = MACOS_BUILD ? '@nimiplatform/kit-protected-local-darwin-arm64' : '@nimiplatform/kit-protected-local-win32-x64';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(appRoot, 'dist-electron-package');
const requireFromApp = createRequire(path.join(appRoot, 'package.json'));

if (!MACOS_BUILD && (process.platform !== 'win32' || process.arch !== 'x64')) {
  throw new Error('Electron production packaging requires a windows-x86_64 or macos-aarch64 build host.');
}

const appPackage = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
const APP_VERSION = appPackage.version;
const RESOURCE_VERSION = MACOS_BUILD ? APP_VERSION : resolveWindowsResourceVersion(APP_VERSION);
for (const sectionName of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  if (Object.hasOwn(appPackage[sectionName] || {}, NATIVE_BINDING_PACKAGE)) {
    throw new Error('The protected native binding must arrive through the Kit optional dependency.');
  }
}
const electronPackage = JSON.parse(await readFile(requireFromApp.resolve('electron/package.json'), 'utf8'));
const kitEntry = requireFromApp.resolve('@nimiplatform/kit/shell/electron/main');
const kitRoot = await findPackageRoot(kitEntry, '@nimiplatform/kit');
const kitPackage = JSON.parse(await readFile(path.join(kitRoot, 'package.json'), 'utf8'));
if (!Object.hasOwn(kitPackage.optionalDependencies || {}, NATIVE_BINDING_PACKAGE)) {
  throw new Error('Kit does not declare the current-platform protected native binding as optional.');
}
const requireFromKit = createRequire(path.join(kitRoot, 'package.json'));
const nativeEntry = requireFromKit.resolve(NATIVE_BINDING_PACKAGE);
const nativePackageRoot = await findPackageRoot(nativeEntry, NATIVE_BINDING_PACKAGE);

await rm(outputRoot, { recursive: true, force: true });
const stagingRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'nimi-electron-packager-')));
const productionSourceRoot = path.join(stagingRoot, 'app');
const packagerTempRoot = path.join(stagingRoot, 'packager');
let packageCompleted = false;

try {
  const mainBundlePath = path.join(appRoot, 'dist-electron/main.js');
  await build({
    entryPoints: [path.join(appRoot, 'electron/main.ts')],
    outfile: mainBundlePath,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: [
      'electron',
      'original-fs',
      'sharp',
      'bufferutil',
      'utf-8-validate',
      '@nimiplatform/kit-protected-local-win32-x64',
      '@nimiplatform/kit-protected-local-darwin-arm64',
    ],
    banner: {
      js: "import { createRequire as __nimiCreateRequire } from 'node:module'; const require = __nimiCreateRequire(import.meta.url);",
    },
    define: { __NIMI_ELECTRON_PRODUCTION__: 'true' },
    logLevel: 'silent',
  });
  await verifyNodeSyntax(mainBundlePath);

  await realpath(path.join(appRoot, 'web', '.next-nimi-production', 'standalone', 'web', 'server.js'));
  await realpath(path.join(appRoot, 'dist-python', 'deeptutor-backend', MACOS_BUILD ? 'deeptutor-backend' : 'deeptutor-backend.exe'));
  await realpath(path.join(appRoot, 'dist-electron', 'preload.cjs'));
  const preloadCheck = await build({
    entryPoints: [path.join(appRoot, 'electron/preload.cts')],
    outfile: path.join(stagingRoot, 'preload-check.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  for (const output of Object.values(preloadCheck.metafile?.outputs || {})) {
    for (const imp of output.imports || []) {
      if (imp.external && imp.path.startsWith('@nimiplatform/')) {
        throw new Error(`Electron preload bundle must not retain external Nimi import: ${imp.path}`);
      }
    }
  }

  await mkdir(path.join(productionSourceRoot, 'dist-electron'), { recursive: true });
  const productionManifest = {
    name: appPackage.name,
    version: APP_VERSION,
    type: 'module',
    main: 'dist-electron/main.js',
    ...(appPackage.license ? { license: appPackage.license } : {}),
    ...(appPackage.author ? { author: appPackage.author } : {}),
  };
  await writeFile(path.join(productionSourceRoot, 'package.json'), `${JSON.stringify(productionManifest, null, 2)}\n`);

  const backendResources = path.join(stagingRoot, 'deeptutor-backend');
  const webResources = path.join(stagingRoot, 'deeptutor-web');
  // PyInstaller's framework links are deliberately relative. Node's default
  // cp rewrites them to the source checkout, which breaks relocated packages.
  await cp(path.join(appRoot, 'dist-python', 'deeptutor-backend'), backendResources, { recursive: true, dereference: !MACOS_BUILD, verbatimSymlinks: MACOS_BUILD });
  // Preserve Next's closed pnpm layout: flattening `web/node_modules/next`
  // changes where Node looks for Next's own sibling dependencies.
  await cp(path.join(appRoot, 'web', '.next-nimi-production', 'standalone'), webResources, { recursive: true, dereference: !MACOS_BUILD, verbatimSymlinks: MACOS_BUILD });
  await cp(path.join(appRoot, 'web', '.next-nimi-production', 'static'), path.join(webResources, 'web', '.next-nimi-production', 'static'), { recursive: true });
  await cp(path.join(appRoot, 'web', 'public'), path.join(webResources, 'web', 'public'), { recursive: true });
  await copyFile(mainBundlePath, path.join(productionSourceRoot, 'dist-electron', 'main.js'));
  await copyFile(path.join(appRoot, 'dist-electron', 'preload.cjs'), path.join(productionSourceRoot, 'dist-electron', 'preload.cjs'));

  const installedNativePackage = path.join(productionSourceRoot, 'node_modules', ...NATIVE_BINDING_PACKAGE.split('/'));
  const nativeDestination = MACOS_BUILD
    ? path.join(stagingRoot, 'nimi-native', 'protected-local')
    : installedNativePackage;
  await mkdir(path.dirname(nativeDestination), { recursive: true });
  await cp(nativePackageRoot, nativeDestination, { recursive: true, dereference: true, force: false });
  await mkdir(packagerTempRoot, { recursive: true });

  await cp(path.join(appRoot, 'assets', 'native'), path.join(productionSourceRoot, 'assets', 'native'), { recursive: true });
  const packagePaths = await packager({
    icon: path.join(appRoot, 'assets', 'native', MACOS_BUILD ? 'macos.icns' : 'windows.ico'),
    dir: productionSourceRoot,
    platform: NATIVE_PLATFORM,
    arch: NATIVE_ARCH,
    appBundleId: 'ai.nimi.apps.org.nimiplatform.deeptutor',
    name: APP_EXECUTABLE_NAME,
    executableName: APP_EXECUTABLE_NAME,
    appVersion: RESOURCE_VERSION,
    buildVersion: RESOURCE_VERSION,
    electronVersion: electronPackage.version,
    out: outputRoot,
    tmpdir: packagerTempRoot,
    overwrite: false,
    asar: { unpack: '*.{node,dylib,dll}' },
    extraResource: [backendResources, webResources, ...(MACOS_BUILD ? [path.join(stagingRoot, 'nimi-native')] : [])],
    afterCopyExtraResources: [async ({ buildPath }) => {
      const resourcesPath = MACOS_BUILD
        ? path.join(buildPath, `${APP_EXECUTABLE_NAME}.app`, 'Contents', 'Resources')
        : path.join(buildPath, 'resources');
      const packagedBackend = path.join(resourcesPath, 'deeptutor-backend');
      await rm(packagedBackend, { recursive: true, force: true });
      await cp(backendResources, packagedBackend, { recursive: true, dereference: !MACOS_BUILD, verbatimSymlinks: MACOS_BUILD });
      const packagedWeb = path.join(resourcesPath, 'deeptutor-web');
      await rm(packagedWeb, { recursive: true, force: true });
      await cp(webResources, packagedWeb, { recursive: true, dereference: !MACOS_BUILD, verbatimSymlinks: MACOS_BUILD });
      await verifyNextStandalone(packagedWeb);
    }],
    prune: false,
    quiet: true,
    derefSymlinks: true,
    ...(MACOS_BUILD ? { osxSign: {
      identity: '-', identityValidation: false, preAutoEntitlements: false,
      preEmbedProvisioningProfile: false, strictVerify: true,
      continueOnError: false,
      optionsForFile: () => ({ entitlements: [], hardenedRuntime: false, timestamp: 'none' }),
    } } : {}),
    beforeAsar: [async ({ buildPath }) => {
      const packagedManifestPath = path.join(buildPath, 'package.json');
      const packagedManifest = JSON.parse(await readFile(packagedManifestPath, 'utf8'));
      packagedManifest.version = APP_VERSION;
      await writeFile(packagedManifestPath, `${JSON.stringify(packagedManifest, null, 2)}\n`);
    }],
    win32metadata: {
      ProductName: APP_PRODUCT_NAME,
      FileDescription: APP_PRODUCT_NAME,
      InternalName: APP_EXECUTABLE_NAME,
      OriginalFilename: `${APP_EXECUTABLE_NAME}.exe`,
      'requested-execution-level': 'asInvoker',
    },
  });
  if (!Array.isArray(packagePaths) || packagePaths.length !== 1) throw new Error('Electron packager returned an ambiguous production package.');
  const expectedPackageRoot = path.join(outputRoot, `${APP_EXECUTABLE_NAME}-${NATIVE_PLATFORM}-${NATIVE_ARCH}`);
  if (path.resolve(packagePaths[0]).toLowerCase() !== path.resolve(expectedPackageRoot).toLowerCase()) {
    throw new Error('Electron packager returned an unexpected production package path.');
  }
  await realpath(MACOS_BUILD
    ? path.join(expectedPackageRoot, `${APP_EXECUTABLE_NAME}.app`, 'Contents', 'MacOS', APP_EXECUTABLE_NAME)
    : path.join(expectedPackageRoot, `${APP_EXECUTABLE_NAME}.exe`));
  const resourcesRoot = MACOS_BUILD
    ? path.join(expectedPackageRoot, `${APP_EXECUTABLE_NAME}.app`, 'Contents', 'Resources')
    : path.join(expectedPackageRoot, 'resources');
  await assertCleanAppBundle(resourcesRoot);
  await verifyNextStandalone(path.join(resourcesRoot, 'deeptutor-web'));
  await verifyFrozenBackend(path.join(resourcesRoot, 'deeptutor-backend'));
  packageCompleted = true;
  process.stdout.write(`[nimi-app] Electron production package: ${expectedPackageRoot}\n`);
} finally {
  const cleanupTasks = [rm(stagingRoot, { recursive: true, force: true })];
  if (!packageCompleted) cleanupTasks.push(rm(outputRoot, { recursive: true, force: true }));
  await Promise.all(cleanupTasks);
}

async function verifyNodeSyntax(scriptPath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', scriptPath], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) { resolve(); return; }
      reject(new Error(`Node syntax check failed for ${scriptPath} (${signal || `exit ${String(code)}`}).`));
    });
  });
}

async function listAsarPaths(asarPath) {
  const handle = await open(asarPath, 'r');
  try {
    const headerPrefix = Buffer.alloc(16);
    const prefixRead = await handle.read(headerPrefix, 0, 16, 0);
    if (prefixRead.bytesRead !== 16) throw new Error('Invalid app.asar header.');
    const jsonLength = headerPrefix.readUInt32LE(12);
    if (jsonLength === 0 || jsonLength > 64 * 1024 * 1024) throw new Error('Invalid app.asar header length.');
    const jsonBuffer = Buffer.alloc(jsonLength);
    const jsonRead = await handle.read(jsonBuffer, 0, jsonLength, 16);
    if (jsonRead.bytesRead !== jsonLength) throw new Error('Truncated app.asar header.');
    const root = JSON.parse(jsonBuffer.toString('utf8'));
    const entries = [];
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node?.files || {})) {
        const next = prefix ? `${prefix}/${name}` : name;
        if (child && typeof child === 'object' && child.files) walk(child, next);
        else entries.push(next);
      }
    };
    walk(root, '');
    return entries;
  } finally {
    await handle.close();
  }
}

async function listTreePaths(rootDir, prefix = '') {
  let items;
  try {
    items = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const paths = [];
  for (const item of items) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) paths.push(...(await listTreePaths(path.join(rootDir, item.name), rel)));
    else paths.push(rel);
  }
  return paths;
}

async function assertCleanAppBundle(resourcesRoot) {
  // Scan ONLY main-process app.asar and app.asar.unpacked; extraResource
  // deeptutor-web legitimately keeps Next.js target-platform sharp.
  const asarPaths = await listAsarPaths(path.join(resourcesRoot, 'app.asar'));
  const unpackedPaths = await listTreePaths(path.join(resourcesRoot, 'app.asar.unpacked'));
  const allPaths = [...asarPaths, ...unpackedPaths];
  const forbiddenPatterns = [
    /(?:^|\/)@electron-internal(?:\/|$)/,
    /(?:^|\/)node_modules\/typescript(?:\/|$)/,
    /(?:^|\/)@img\/sharp-/,
    ...(MACOS_BUILD
      ? [/\.dll$/i, /(?:^|\/)kit-protected-local-win32-x64(?:\/|$)/, /win32-x64.*\.node$/i, /linux-.*\.node$/i]
      : [/\.dylib$/i, /(?:^|\/)kit-protected-local-darwin-arm64(?:\/|$)/, /darwin-arm64.*\.node$/i, /linux-.*\.node$/i]),
  ];
  for (const entryPath of allPaths) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(entryPath)) {
        throw new Error(`Unexpected contaminated payload entry in Electron bundle: ${entryPath}`);
      }
    }
  }
}

async function findPackageRoot(entry, expectedName) {
  let current = path.dirname(await realpath(entry));
  for (;;) {
    const manifestPath = path.join(current, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.name === expectedName) return current;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Unable to locate installed package ${expectedName}.`);
    current = parent;
  }
}
