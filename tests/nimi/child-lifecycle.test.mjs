import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { build } from "esbuild";

// Exercise the real owner cleanup with real OS children. Electron is unused
// by stop(); avoid starting an independent, unsupervised Electron Host.
async function loadOwner(file, name) {
  const result = await build({
    entryPoints: [file], bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "electron-test-boundary", setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const app = {}; export const session = {};" }));
    } }],
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  return module[name];
}

for (const [file, name] of [
  ["electron/backend.ts", "DeepTutorBackend"],
  ["electron/renderer-server.ts", "DeepTutorRendererServer"],
]) {
  for (const alreadyExited of [false, true]) {
    test(`${name} stops ${alreadyExited ? "an already signal-terminated" : "a live"} child`, { timeout: 5000 }, async () => {
      const Owner = await loadOwner(file, name);
      const owner = new Owner();
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
      await once(child, "spawn");
      owner.child = child;
      const pipe = new PassThrough();
      if (name === "DeepTutorBackend") owner.pipe = pipe;
      try {
        if (alreadyExited) {
          const exited = once(child, "exit");
          process.kill(-child.pid, "SIGTERM");
          await exited;
          assert.equal(child.exitCode, null);
          assert.equal(child.signalCode, "SIGTERM");
        }
        await owner.stop();
        await owner.stop();
        assert.equal(child.signalCode, "SIGTERM");
        if (name === "DeepTutorBackend") assert.equal(pipe.destroyed, true);
      } finally {
        if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGKILL");
        pipe.destroy();
      }
    });
  }
}
