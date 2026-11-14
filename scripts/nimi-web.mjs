import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, watchFile, unwatchFile } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readWebDevelopment } from '@nimiplatform/app-tools/web';
import { configureTypeIncludes } from '../web/scripts/next-type-includes.mjs';
import { parse } from 'yaml';
import { readMobileAccess } from './mobile-config.mjs';

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'build') throw new Error('Expected dev or build');
// The Android development APK can use the built UI on the same declared HTTPS
// source. This avoids the large eval/source-map payload of a development bundle.
if (mode === 'dev' && process.env.DEEPTUTOR_OPTIMIZED_WEB === '1') {
  await import('./nimi-web-preview.mjs');
} else {
const root = path.resolve(import.meta.dirname, '..');
const webRoot = path.join(root, 'web');
const envPath = path.join(root, '.env.web.local');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const flag = process.argv.indexOf('--realm');
const realmMode = flag >= 0 ? process.argv[flag + 1] : undefined;
const { site, config } = readWebDevelopment(parse(readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8')), { realm: realmMode });
function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Set ${key} in .env.web.local to a browser-trusted certificate file`);
  return path.resolve(root, value);
}
const require = createRequire(import.meta.url);
const declarations = path.join(webRoot, 'next-env.d.ts');
const originalDeclarations = readFileSync(declarations, 'utf8');
const isolatedConfig = path.join(webRoot, `tsconfig.deeptutor-web-${process.pid}.json`);
if (mode === 'dev') writeFileSync(isolatedConfig, configureTypeIncludes(readFileSync(path.join(webRoot, 'tsconfig.json'), 'utf8'), '.next-web'));
function restoreDeclarations() {
  // Next always writes this root file even with a separate tsconfig. Restore
  // only this server's generated declaration, preserving Native or user edits.
  if (readFileSync(declarations, 'utf8') === originalDeclarations.replaceAll('./.next-nimi/', './.next-web/')) writeFileSync(declarations, originalDeclarations);
}
// Next's dev bundler re-runs type setup after config changes. Its root
// declaration is unconditional, even with tsconfigPath; fence only this exact
// generated projection while both native and Web dev servers share the source.
if (mode === 'dev') watchFile(declarations, { interval: 250, persistent: false }, restoreDeclarations);
const args = mode === 'build' ? [path.join(root, 'web/scripts/build.mjs')] : [
  require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', site.port,
  '--experimental-https', '--experimental-https-key', required('NIMI_WEB_TLS_KEY'), '--experimental-https-cert', required('NIMI_WEB_TLS_CERT'),
];
const child = spawn(process.execPath, args, {
  cwd: webRoot, windowsHide: true,
  stdio: mode === 'dev' ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  env: { ...process.env, DEEPTUTOR_NIMI_WEB_CONFIG: JSON.stringify(config),
    DEEPTUTOR_NIMI_MOBILE_CONFIG: (realmMode ?? process.env.NIMI_DEV_REALM) === 'local' ? JSON.stringify(readMobileAccess(realmMode)) : '',
    DEEPTUTOR_NEXT_DIST_DIR: mode === 'dev' ? '.next-web' : '.next-web-build',
    ...(mode === 'dev' ? { DEEPTUTOR_NEXT_TSCONFIG: path.basename(isolatedConfig) } : {}),
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
    NODE_ENV: mode === 'dev' ? 'development' : 'production', NIMI_DEEPTUTOR_CARRIER: 'web' },
});
let startupOutput = '';
child.stdout?.on('data', chunk => {
  process.stdout.write(chunk);
  startupOutput = (startupOutput + chunk.toString()).slice(-2048);
  if (startupOutput.includes('Ready in')) { restoreDeclarations(); startupOutput = ''; }
});
child.stderr?.pipe(process.stderr);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => {
  if (mode === 'dev') { unwatchFile(declarations, restoreDeclarations); restoreDeclarations(); rmSync(isolatedConfig, { force: true }); }
  process.exitCode = code ?? 1;
});
}
