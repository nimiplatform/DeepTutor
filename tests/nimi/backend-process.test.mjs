import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { childEnvironment } from "../../scripts/nimi-runtime-config.mjs";
import { pythonExecutable } from '../../scripts/nimi-python-path.mjs';
import { stopOwnedChild } from '../../electron/owned-child.ts';

test("the real Python worker serves only its Host's authenticated business requests", { timeout: 45000 }, async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  await mkdir(".nimi/local", { recursive: true });
  const dataRoot = await mkdtemp(path.resolve(".nimi/local/后端验收-"));
  const frozenWorker = process.env.DEEPTUTOR_TEST_FROZEN_WORKER;
  const child = spawn(path.resolve(frozenWorker || pythonExecutable), [
    ...(frozenWorker ? [] : ["-m", "deeptutor.nimi.worker"]), "--port", String(port),
  ], {
    // Match BackendProcess: Unix cleanup addresses the child-owned process group.
    detached: true, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    env: { ...childEnvironment(), DEEPTUTOR_HOME: dataRoot },
  });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk.toString("utf8")).slice(-6000); });
  const token = "a".repeat(64);
  child.stdin.write(JSON.stringify({ type: "initialize", apiToken: token, rendererOrigin: "http://127.0.0.1:1467" }) + "\n", "utf8");
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(child.exitCode, null, diagnostics);
      try {
        const response = await fetch(`${base}/health/ready`, { headers: { Cookie: `deeptutor_host=${token}` }, signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* wait for the exact child */ }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, diagnostics);
    assert.equal((await fetch(`${base}/health/ready`)).status, 401);
    assert.equal((await fetch(`${base}/health/ready`, { headers: { Cookie: `deeptutor_host=${token}`, Origin: "https://unrelated.example" } })).status, 401);
    const result = await fetch(`${base}/health/ready`, { headers: { Cookie: `deeptutor_host=${token}`, Origin: "http://127.0.0.1:1467" } });
    assert.deepEqual(await result.json(), { status: "ready" });
    const name = "中文学习档案 · 傅里叶 αβ";
    const created = await fetch(`${base}/api/notebooks`, {
      method: "POST", headers: { Cookie: `deeptutor_host=${token}`, "Content-Type": "application/json", Origin: "http://127.0.0.1:1467" },
      body: JSON.stringify({ name }),
    });
    assert.equal(created.status, 200);
    const notebook = (await created.json()).notebook;
    assert.equal(notebook.name, name);
    const saved = JSON.parse(await readFile(path.join(dataRoot, "data/user/workspace/notebook", `${notebook.id}.json`), "utf8"));
    assert.equal(saved.name, name);
  } finally {
    await stopOwnedChild(child, 4000);
    child.stdin.destroy();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
