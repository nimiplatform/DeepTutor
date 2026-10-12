import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const probe = spawnSync('uv', ['--version'], { encoding: 'utf8' });
let executable = 'uv';
if (probe.error?.code === 'ENOENT') {
  const folder = path.join(root, '.nimi', 'local', 'toolchain-python');
  const windows = process.platform === 'win32';
  const python = path.join(folder, windows ? 'Scripts/python.exe' : 'bin/python');
  executable = path.join(folder, windows ? 'Scripts/uv.exe' : 'bin/uv');
  mkdirSync(path.dirname(folder), { recursive: true });
  const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed (${result.status})`);
  };
  if (!existsSync(python)) run(windows ? 'python' : 'python3', ['-m', 'venv', folder]);
  if (!existsSync(executable)) run(python, ['-m', 'pip', 'install', 'uv==0.9.28']);
} else if (probe.error || probe.status !== 0) {
  throw probe.error || new Error('uv version check failed');
}
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
