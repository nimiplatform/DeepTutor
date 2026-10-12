import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { BACKEND_ORIGIN, BACKEND_PORT, childEnvironment } from "./nimi-runtime-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = parse(readFileSync(new URL("../nimi.app.yaml", import.meta.url), "utf8"));
const origin = new URL(manifest.local_development.electron.renderer_origin);
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port) {
  throw new Error("DeepTutor development requires an explicit IPv4 loopback renderer origin.");
}
const child = spawn(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ["pnpm", "--dir", "web", "dev", "--hostname", origin.hostname, "--port", origin.port], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === 'win32',
  windowsHide: true,
  env: {
    ...childEnvironment(),
    DEEPTUTOR_API_BASE_URL: BACKEND_ORIGIN,
    BACKEND_PORT: String(BACKEND_PORT),
    NEXT_PUBLIC_API_BASE: origin.origin,
    NEXT_PUBLIC_AUTH_ENABLED: "false",
    DEEPTUTOR_NEXT_DIST_DIR: ".next-nimi",
  },
});
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
