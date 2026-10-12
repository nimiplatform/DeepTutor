import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!existsSync(fileURLToPath(new URL('../.venv/bin/python', import.meta.url)))) {
  const result = spawnSync('pnpm', ['run', 'setup:python'], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error('DeepTutor Python setup failed');
}
