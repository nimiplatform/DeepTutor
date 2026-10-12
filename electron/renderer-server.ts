import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { BACKEND_ORIGIN, BACKEND_PORT, childEnvironment } from '../scripts/nimi-runtime-config.mjs';
import { stopOwnedChild } from './owned-child.js';

/** Own the Next standalone server in the packaged App. Dev uses Desktop's
 * existing dev:renderer process; both retain DeepTutor's server routes. */
export class DeepTutorRendererServer {
  private child: ChildProcess | undefined;
  private reservation: Server | undefined;
  private origin: string | undefined;

  async prepare(): Promise<string> {
    if (this.origin) return this.origin;
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Cannot select a loopback renderer port.');
    this.reservation = reservation;
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.origin;
  }

  async start(): Promise<string> {
    const origin = await this.prepare();
    const port = new URL(origin).port;
    await new Promise<void>((resolve) => this.reservation!.close(() => resolve()));
    this.reservation = undefined;
    const root = path.join(process.resourcesPath, 'deeptutor-web', 'web');
    this.child = spawn(process.execPath, [path.join(root, 'server.js')], {
      cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...childEnvironment(), ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1', PORT: String(port), BACKEND_PORT: String(BACKEND_PORT),
        DEEPTUTOR_API_BASE_URL: BACKEND_ORIGIN, NEXT_PUBLIC_API_BASE: origin },
    });
    this.child.stdout?.pipe(process.stdout);
    this.child.stderr?.pipe(process.stderr);
    let stderr = '';
    this.child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-8192); });
    let failure: Error | undefined;
    this.child.once('error', (error) => { failure = error; });
    for (let attempt = 0; attempt < 150; attempt++) {
      if (failure) throw failure;
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        throw new Error(`Next server exited (${this.child.signalCode ?? this.child.exitCode}).\n${stderr}`);
      }
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return origin;
      } catch { /* await the owned server */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`The packaged Next server did not become ready.\n${stderr}`);
  }

  async stop(): Promise<void> {
    if (this.reservation) {
      await new Promise<void>((resolve) => this.reservation!.close(() => resolve()));
      this.reservation = undefined;
    }
    const child = this.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    await stopOwnedChild(child, 5000);
  }
}
