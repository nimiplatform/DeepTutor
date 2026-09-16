import assert from "node:assert/strict";
import test from "node:test";
import { childEnvironment } from "../../scripts/nimi-runtime-config.mjs";

test("business children inherit OS locations and UTF-8 without platform or provider credentials", () => {
  const result = childEnvironment({
    HOME: "/test/home",
    PATH: "/test/bin",
    NIMI_RUNTIME_ENDPOINT: "private-runtime",
    NIMI_APP_TOKEN: "test-secret",
    OPENAI_API_KEY: "test-provider-key",
    DEEPTUTOR_API_TOKEN: "test-business-token",
    NODE_OPTIONS: "--require=/test/injection.cjs",
    PYTHONPATH: "/test/injection",
    PYTHONIOENCODING: "latin-1",
  });
  assert.deepEqual(result, {
    HOME: "/test/home",
    PATH: "/test/bin",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  });
});
