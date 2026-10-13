import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");
const testRoot = path.join(webRoot, "tests");
const require = createRequire(import.meta.url);

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function collectTests(dir) {
  const entries = readdirSync(dir)
    .map(name => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b));
  const files = [];
  for (const entry of entries) {
    const stats = statSync(entry);
    if (stats.isDirectory()) {
      files.push(...collectTests(entry));
      continue;
    }
    if (entry.endsWith(".test.ts")) {
      files.push(entry);
    }
  }
  return files;
}

run(process.execPath, [
  path.join(webRoot, "scripts", "typecheck.mjs"),
]);

const testFiles = collectTests(testRoot);
if (testFiles.length === 0) {
  console.error("No node tests found.");
  process.exit(1);
}

run(process.execPath, [
  require.resolve("tsx/cli"),
  "--tsconfig",
  "tsconfig.json",
  "--test",
  ...testFiles,
]);
