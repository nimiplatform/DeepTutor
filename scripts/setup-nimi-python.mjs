import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { projectRoot, pythonExecutable } from './nimi-python-path.mjs';

const steps = [
  ...(existsSync(pythonExecutable) ? [] : [['venv', '.venv', '--python', '3.12']]),
  ['pip', 'install', '--python', pythonExecutable, '-r', 'requirements/full.txt', '-r', 'requirements/dev.txt', 'pyinstaller>=6.0,<7.0'],
  ['pip', 'install', '--python', pythonExecutable, '--no-deps', '-e', '.'],
];
for (const args of steps) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/nimi-uv.mjs'), ...args], { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`DeepTutor Python setup failed (${result.status})`);
}
