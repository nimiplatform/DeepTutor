import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(path.resolve(process.cwd(), "package.json"));

test("frontend tools resolve and execute through the current Node runtime", () => {
  for (const tool of ["typescript/bin/tsc", "tsx/cli"]) {
    const result = spawnSync(process.execPath, [require.resolve(tool), "--version"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /(?:Version|tsx v)\s*\d+\./);
  }
});
