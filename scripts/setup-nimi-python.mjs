import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot, pythonExecutable } from './nimi-python-path.mjs';

for (const args of [
  ['venv', '.venv', '--python', '3.12'],
  ['pip', 'install', '--python', pythonExecutable, '-e', '.[dev,nimi-host]'],
]) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/nimi-uv.mjs'), ...args], { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`DeepTutor Python setup failed (${result.status})`);
}
