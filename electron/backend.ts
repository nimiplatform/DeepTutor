import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { app, session } from 'electron';
import { BACKEND_PORT, BACKEND_ORIGIN, childEnvironment } from '../scripts/nimi-runtime-config.mjs';
import { stopOwnedChild } from './owned-child.js';
import WebSocket from 'ws';

export class DeepTutorBackend {
  private child: ChildProcess | undefined;
  private stopping: Promise<void> | undefined;
  private readonly token = randomBytes(32).toString('hex');
  pipe: Duplex | undefined;
  ready = false;

  /** Internal App-owned broker only. The provider validates its closed business route before calling this. */
  request(pathAndQuery: string, init: RequestInit, businessCookie?: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('cookie', `deeptutor_host=${this.token}${businessCookie ? `; dt_token=${businessCookie}` : ''}`);
    return fetch(`${BACKEND_ORIGIN}${pathAndQuery}`, { ...init, headers, redirect: 'manual' });
  }

  socket(pathAndQuery: string, businessCookie?: string): WebSocket {
    return new WebSocket(`${BACKEND_ORIGIN.replace('http:', 'ws:')}${pathAndQuery}`, {
      headers: { cookie: `deeptutor_host=${this.token}${businessCookie ? `; dt_token=${businessCookie}` : ''}` },
      maxPayload: 2 * 1024 * 1024,
    });
  }

  async start(appRoot: string, rendererOrigin: string, ai?: { generation: number; attach(pipe: Duplex): void }): Promise<void> {
    const dataRoot = path.join(app.getPath('userData'), 'workspace');
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'deeptutor-backend', process.platform === 'win32' ? 'deeptutor-backend.exe' : 'deeptutor-backend')
      : path.join(appRoot, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
    const args = app.isPackaged ? [] : ['-m', 'deeptutor.nimi.worker'];
    this.child = spawn(executable, [...args, '--port', String(BACKEND_PORT)], {
      cwd: app.isPackaged ? dataRoot : appRoot,
      detached: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...childEnvironment(), DEEPTUTOR_HOME: dataRoot,
        BACKEND_PORT: String(BACKEND_PORT), FRONTEND_PORT: new URL(rendererOrigin).port },
    });
    this.child.stderr?.pipe(process.stderr);
    this.pipe = Duplex.from({ readable: this.child.stdout!, writable: this.child.stdin! });
    ai?.attach(this.pipe);
    this.pipe.write(JSON.stringify({ type: 'initialize', apiToken: this.token, rendererOrigin, generation: ai?.generation ?? 1 }) + '\n', 'utf8');
    await session.defaultSession.cookies.set({
      url: rendererOrigin, name: 'deeptutor_host', value: this.token,
      httpOnly: true, sameSite: 'strict', path: '/',
    });
    let spawnError: Error | undefined;
    this.child.once('error', (error) => { spawnError = error; });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        throw new Error(`DeepTutor backend exited (${this.child.signalCode ?? this.child.exitCode}).`);
      }
      try {
        const response = await fetch(`${BACKEND_ORIGIN}/health/ready`, {
          headers: { Cookie: `deeptutor_host=${this.token}` }, signal: AbortSignal.timeout(1000),
        });
        if (response.ok) { this.ready = true; return; }
      } catch { /* The exact child is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await this.stop();
    throw new Error('DeepTutor backend did not become ready within 60 seconds.');
  }

  stop(): Promise<void> {
    this.ready = false;
    return this.stopping ??= this.stopChild();
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
      this.pipe?.destroy();
      return;
    }
    await stopOwnedChild(child, 8000);
    this.pipe?.destroy();
  }
}
