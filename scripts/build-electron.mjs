import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(new URL("../dist-electron/", import.meta.url), { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.js",
  bundle: true, platform: "node", target: "node22", format: "esm",
  packages: "external", external: ["electron"],
  define: { __NIMI_ELECTRON_PRODUCTION__: "false" },
});
await build({
  absWorkingDir: root, entryPoints: ["electron/preload.cts"], outfile: "dist-electron/preload.cjs",
  bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"],
});
