// App-owned backend port. Desktop owns the renderer origin in nimi.app.yaml.
// Binding an occupied port must fail; never attach to another backend process.
export const BACKEND_HOST = "127.0.0.1";
export const BACKEND_PORT = 18671;
export const BACKEND_ORIGIN = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

export function childEnvironment(source = process.env) {
  const environment = {};
  for (const name of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR", "LANG", "LC_ALL", "LC_CTYPE"]) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return { ...environment, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
}
