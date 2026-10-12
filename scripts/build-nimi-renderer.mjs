import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './nimi-python-path.mjs';

const projection = path.join(projectRoot, 'web/next-env.d.ts');
const original = readFileSync(projection);
try {
  const result = spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['pnpm', '--dir', 'web', 'build'], {
    cwd: projectRoot, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
    env: { ...process.env, DEEPTUTOR_NIMI_PACKAGE: '1', DEEPTUTOR_NEXT_DIST_DIR: '.next-nimi-production' },
  });
  if (result.error || result.status !== 0) throw result.error || new Error(`DeepTutor renderer build failed (${result.status})`);
} finally { writeFileSync(projection, original); }
