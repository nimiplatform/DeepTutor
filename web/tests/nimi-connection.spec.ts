import { describe, expect, it, vi } from "vitest";
import { readNimiModelConfiguration } from "../lib/nimi-client";

describe("explicit Nimi connection recovery", () => {
  it("reads session status before configuration and does not write or consume AI", async () => {
    const order: string[] = [];
    const config = { revision: "r3", config: null, effectiveSelections: [] };
    const client = {
      auth: {
        status: vi.fn(async () => {
          order.push("status");
          return { sessionBound: true, reasonCode: "ready" };
        }),
      },
      aiConfig: {
        get: vi.fn(async () => {
          order.push("config");
          return config;
        }),
        overwrite: vi.fn(),
      },
      ai: { generate: vi.fn() },
    };
    const result = await readNimiModelConfiguration(
      client as unknown as Parameters<typeof readNimiModelConfiguration>[0],
    );
    expect(result).toBe(config);
    expect(order).toEqual(["status", "config"]);
    expect(client.aiConfig.overwrite).not.toHaveBeenCalled();
    expect(client.ai.generate).not.toHaveBeenCalled();
  });

  it("preserves unavailable reason and action without proceeding to configuration", async () => {
    const get = vi.fn();
    const client = {
      auth: {
        status: async () => ({
          sessionBound: false,
          reasonCode: "runtime-service-unavailable",
          actionHint: "open_nimi_desktop_and_retry",
        }),
      },
      aiConfig: { get },
    };
    await expect(readNimiModelConfiguration(client)).rejects.toMatchObject({
      reasonCode: "runtime-service-unavailable",
      actionHint: "open_nimi_desktop_and_retry",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("does not retry a failed public read", async () => {
    const error = Object.assign(new Error("Unavailable"), {
      reasonCode: "runtime-service-unavailable",
    });
    const get = vi.fn().mockRejectedValue(error);
    const client = {
      auth: {
        status: async () => ({ sessionBound: true, reasonCode: "ready" }),
      },
      aiConfig: { get },
    };
    await expect(readNimiModelConfiguration(client)).rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
