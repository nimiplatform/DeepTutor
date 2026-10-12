import { spawnSync } from 'node:child_process';
import { projectRoot, pythonExecutable } from './nimi-python-path.mjs';

const result = spawnSync(pythonExecutable, process.argv.slice(2), {
  cwd: projectRoot, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
