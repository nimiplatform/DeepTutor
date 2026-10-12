import { existsSync } from 'node:fs';
import { pythonExecutable } from './nimi-python-path.mjs';

if (!existsSync(pythonExecutable)) await import('./setup-nimi-python.mjs');
