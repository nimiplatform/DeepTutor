import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('packaged Host binds its profile before any other Kit module loads', async () => {
  const result = await build({ entryPoints: ['electron/main.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', external: ['electron'], write: false,
    define: { __NIMI_ELECTRON_PRODUCTION__: 'true' } });
  const source = result.outputFiles[0].text;
  const imports = [...source.matchAll(/^import\s+(?!\()[^;]*?\sfrom\s["'](@nimiplatform\/kit[^"']+)["']/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['@nimiplatform/kit/shell/electron/host-profile']);
  assert.ok(source.includes('await import("@nimiplatform/kit/shell/electron/main")'));
});
