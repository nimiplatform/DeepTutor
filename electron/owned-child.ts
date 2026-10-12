import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/** Stop only the process tree created by this App owner. */
export async function stopOwnedChild(child: ChildProcess | undefined, forceAfterMs: number): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw new Error('Windows SystemRoot is unavailable for child cleanup.');
    await new Promise<void>((resolve, reject) => {
      const killer = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', reject);
      killer.once('exit', (code) => {
        if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
        else reject(new Error(`The App child process tree could not be stopped (${code}).`));
      });
    });
    await exited;
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    try { process.kill(-child.pid!, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  signal('SIGTERM');
  const force = setTimeout(() => signal('SIGKILL'), forceAfterMs);
  try { await exited; } finally { clearTimeout(force); }
}
