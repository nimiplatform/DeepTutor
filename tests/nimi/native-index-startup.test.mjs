import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { pythonExecutable } from "../../scripts/nimi-python-path.mjs";
import { childEnvironment } from "../../scripts/nimi-runtime-config.mjs";
import { stopOwnedChild } from "../../electron/owned-child.ts";

test("the Windows worker loads FAISS before a background reader holds piped stdin", {
  skip: process.platform !== "win32",
  timeout: 25000,
}, async () => {
  // Use the real native library, not an embedding-service substitute. Loading
  // its OpenBLAS DLL after the Host reader blocks on stdin deadlocks on Windows.
  const source = `
import deeptutor.nimi.worker
import json, sys, threading, time
reading = threading.Event()
def read_host():
    reading.set()
    sys.stdin.buffer.readline()
reader = threading.Thread(target=read_host)
reader.start()
reading.wait()
time.sleep(0.1)
import faiss
import numpy as np
index = faiss.IndexFlatIP(2)
index.add(np.array([[1, 0], [0, 1]], dtype="float32"))
scores, neighbors = index.search(np.array([[0, 1]], dtype="float32"), 2)
print(json.dumps({"neighbors": neighbors.tolist(), "scores": scores.tolist()}), flush=True)
reader.join()
`;
  const child = spawn(pythonExecutable, ["-u", "-c", source], {
    detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: childEnvironment(),
  });
  let stdout = "", stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  let timer;
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`FAISS did not load with the Host reader active. ${stderr}`)), 15000);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Worker exited before indexing (${code}): ${stderr}`)));
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        if (stdout.includes("\n")) {
          try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(error); }
        }
      });
    });
    assert.deepEqual(result, { neighbors: [[1, 0]], scores: [[1, 0]] });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.stdin.end("stop\n");
    assert.equal(await exited, 0, stderr);
  } finally {
    clearTimeout(timer);
    await stopOwnedChild(child, 2000);
    child.stdin.destroy();
  }
});
