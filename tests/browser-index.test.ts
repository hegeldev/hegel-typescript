import { afterEach, expect, it, vi } from "vitest";
import { wasmBytes } from "./wasmFixture.js";
import * as node from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("auto-initializes the browser composition root and preserves the public exports", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(wasmBytes, {
      headers: { "Content-Type": "application/wasm" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const browser = await import("../src/browser/index.js");
  expect(Object.keys(browser).sort()).toEqual(Object.keys(node).sort());
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    new URL("../src/browser/libhegel-wasm32-unknown-unknown.wasm", import.meta.url),
  );
  expect(
    browser.test((tc) => {
      expect(tc.draw(browser.generators.integers({ minValue: 1, maxValue: 1 }))).toBe(1);
    }),
  ).toBeUndefined();
  await browser.testAsync(
    async (tc) => {
      await Promise.resolve();
      expect(tc.draw(browser.generators.booleans())).toBeTypeOf("boolean");
    },
    { testCases: 2 },
  );
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() =>
    browser.test(
      (tc) => {
        tc.draw(browser.generators.integers({ minValue: 1, maxValue: 1 }));
        tc.note("browser note");
        throw new Error("browser failure");
      },
      { seed: 42 },
    ),
  ).toThrow("browser failure");
  expect(error).toHaveBeenCalledWith("browser note");
  expect(error).toHaveBeenCalledWith("var draw_1 =", 1);
});
