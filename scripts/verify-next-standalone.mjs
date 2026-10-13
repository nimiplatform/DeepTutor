import { spawn } from 'node:child_process';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnvironment } from './nimi-runtime-config.mjs';
import { stopOwnedChild } from '../electron/owned-child.ts';

// Exercise the actual server resources outside the checkout. A server started
// under the repository can accidentally borrow missing dependencies from its
// ancestor node_modules. The copy also keeps test caches out of the final App.
export async function verifyNextStandalone(resourceRoot) {
  const temporaryRoot = await realpath(tmpdir());
  const isolated = await mkdtemp(path.join(temporaryRoot, 'deeptutor-next-'));
  let child;
  let reservation;
  try {
    await cp(resourceRoot, isolated, {
      recursive: true,
      dereference: process.platform === 'win32',
      verbatimSymlinks: process.platform !== 'win32',
    });
    const serverRoot = path.join(isolated, 'web');
    await realpath(path.join(serverRoot, 'server.js'));
    reservation = createServer();
    await new Promise((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    reservation = undefined;
    child = spawn(process.execPath, [path.join(serverRoot, 'server.js')], {
      cwd: serverRoot, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...childEnvironment(), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port) },
    });
    let failure;
    let diagnostics = '';
    child.once('error', error => { failure = error; });
    const capture = chunk => { diagnostics = (diagnostics + chunk.toString('utf8')).slice(-12000); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Packaged Next server exited (${child.signalCode ?? child.exitCode}).\n${diagnostics}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
        const ready = response.ok && response.headers.get('content-type')?.includes('text/html');
        await response.body?.cancel();
        if (ready && child.exitCode === null && child.signalCode === null) {
          process.stdout.write('[deeptutor-package] Isolated Next server returned its HTML successfully.\n');
          return;
        }
      } catch { /* The owned server is still starting; the deadline is finite. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Packaged Next server did not return its HTML.\n${diagnostics}`);
  } finally {
    if (reservation?.listening) await new Promise(resolve => reservation.close(resolve));
    await stopOwnedChild(child, 2000);
    if (path.dirname(isolated) !== temporaryRoot || !path.basename(isolated).startsWith('deeptutor-next-')) {
      throw new Error('Refusing cleanup outside the owned renderer verification directory.');
    }
    await rm(isolated, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the standalone resource directory.');
  await verifyNextStandalone(await realpath(process.argv[2]));
}
