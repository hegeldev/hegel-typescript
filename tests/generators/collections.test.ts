import { describe, expect, it } from "vitest";
import { BasicGenerator, integers, booleans, text, lists, dicts, draw, runHegelTest } from "hegel";
import { CompositeListGenerator, CompositeDictGenerator } from "../../src/generators/index.js";
import { _testContextStorage } from "../../src/runner.js";

// ---------------------------------------------------------------------------
// dicts() — unit tests (schema structure)
// ---------------------------------------------------------------------------

describe("dicts() basic path", () => {
  it("returns a BasicGenerator when both keys and values are basic", () => {
    const gen = dicts(text(), integers());
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type=dict with keys, values, min_size fields", () => {
    const gen = dicts(text(), integers(0, 100), 0, 5) as BasicGenerator<Record<string, unknown>>;
    const schema = gen.schema();
    expect(schema["type"]).toBe("dict");
    expect(schema["keys"]).toEqual({ type: "string", min_size: 0 });
    expect(schema["values"]).toEqual({ type: "integer", min_value: 0, max_value: 100 });
    expect(schema["min_size"]).toBe(0);
    expect(schema["max_size"]).toBe(5);
  });

  it("schema omits max_size when not provided", () => {
    const gen = dicts(text(), integers()) as BasicGenerator<Record<string, unknown>>;
    const schema = gen.schema();
    expect(schema["max_size"]).toBeUndefined();
  });

  it("generates a record (plain object) via live server", async () => {
    await runHegelTest(
      async () => {
        const result = await draw(dicts(text(1, 5), integers(0, 100), 0, 3));
        expect(result).toBeDefined();
        expect(typeof result).toBe("object");
        expect(result).not.toBeNull();
        // Must be a plain object (not a Map)
        expect(result instanceof Map).toBe(false);
        // All keys should be strings
        for (const key of Object.keys(result as Record<string, unknown>)) {
          expect(typeof key).toBe("string");
        }
      },
      { testCases: 30 },
    );
  });

  it("generates dict respecting min_size=1", async () => {
    await runHegelTest(
      async () => {
        const result = (await draw(dicts(text(1, 5), integers(0, 100), 1, 5))) as Record<
          string,
          unknown
        >;
        expect(Object.keys(result).length).toBeGreaterThanOrEqual(1);
      },
      { testCases: 30 },
    );
  });

  it("applies key transform when keys have a transform", async () => {
    // Use integers mapped to strings — keys get a transform applied
    const mappedKeys = integers(0, 9).map((n) => `key_${n}`);
    await runHegelTest(
      async () => {
        const result = (await draw(dicts(mappedKeys, integers(0, 100), 0, 3))) as Record<
          string,
          unknown
        >;
        for (const key of Object.keys(result)) {
          expect(key).toMatch(/^key_[0-9]$/);
        }
      },
      { testCases: 30 },
    );
  });

  it("applies value transform when values have a transform", async () => {
    const doubledInts = integers(0, 50).map((n) => n * 2);
    await runHegelTest(
      async () => {
        const result = (await draw(dicts(text(1, 5), doubledInts, 0, 3))) as Record<
          string,
          unknown
        >;
        for (const val of Object.values(result)) {
          expect(typeof val).toBe("number");
          expect((val as number) % 2).toBe(0);
        }
      },
      { testCases: 30 },
    );
  });

  it("applies both key and value transforms", async () => {
    const uppercaseKeys = text(1, 5).map((s) => s.toUpperCase());
    const negatedInts = integers(1, 100).map((n) => -n);
    await runHegelTest(
      async () => {
        const result = (await draw(dicts(uppercaseKeys, negatedInts, 0, 3))) as Record<
          string,
          unknown
        >;
        for (const [k, v] of Object.entries(result)) {
          expect(k).toBe(k.toUpperCase());
          expect(typeof v).toBe("number");
          expect(v as number).toBeLessThan(0);
        }
      },
      { testCases: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// dicts() — CompositeDictGenerator (non-basic path)
// ---------------------------------------------------------------------------

describe("dicts() non-basic path (CompositeDictGenerator)", () => {
  it("returns a CompositeDictGenerator when key has filter", () => {
    const filteredKeys = integers(0, 10).filter((x) => x > 5);
    const gen = dicts(filteredKeys, booleans());
    expect(gen).toBeInstanceOf(CompositeDictGenerator);
  });

  it("returns a CompositeDictGenerator when value has filter", () => {
    const filteredVals = integers(0, 100).filter((x) => x % 2 === 0);
    const gen = dicts(text(), filteredVals);
    expect(gen).toBeInstanceOf(CompositeDictGenerator);
  });

  it("generates a Map via live server", async () => {
    await runHegelTest(
      async () => {
        const filteredKeys = text(1, 3).filter((s) => s.length > 0);
        const result = await draw(dicts(filteredKeys, integers(0, 100), 0, 3));
        expect(result).toBeInstanceOf(Map);
        for (const [k, v] of (result as Map<string, number>).entries()) {
          expect(typeof k).toBe("string");
          expect(k.length).toBeGreaterThan(0);
          expect(typeof v).toBe("number");
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      },
      { testCases: 30 },
    );
  });

  it("respects min_size and max_size constraints", async () => {
    await runHegelTest(
      async () => {
        const filteredKeys = integers(0, 10).filter((x) => x > 5);
        const result = (await draw(dicts(filteredKeys, booleans(), 1, 3))) as Map<number, boolean>;
        expect(result.size).toBeGreaterThanOrEqual(1);
        expect(result.size).toBeLessThanOrEqual(3);
      },
      { testCases: 30 },
    );
  });

  it("uses min_size+10 as default max when maxSize is null", async () => {
    // With minSize=0, maxSize=null -> max = 0+10 = 10
    await runHegelTest(
      async () => {
        const filteredKeys = text(1, 3).filter((s) => s.length > 0);
        const result = (await draw(dicts(filteredKeys, integers(), 0))) as Map<string, number>;
        expect(result.size).toBeLessThanOrEqual(10);
      },
      { testCases: 20 },
    );
  });

  it("stores _minSize and _maxSize correctly", () => {
    const gen = dicts(
      integers().filter(() => true),
      booleans(),
      2,
      5,
    ) as CompositeDictGenerator<number, boolean>;
    expect(gen._minSize).toBe(2);
    expect(gen._maxSize).toBe(5);
  });

  it("stores _minSize and null _maxSize correctly", () => {
    const gen = dicts(
      integers().filter(() => true),
      booleans(),
      1,
    ) as CompositeDictGenerator<number, boolean>;
    expect(gen._minSize).toBe(1);
    expect(gen._maxSize).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lists()
// ---------------------------------------------------------------------------

describe("lists()", () => {
  // --- Unit tests: schema structure ---

  it("basic element, no transform: returns BasicGenerator with type=list schema", () => {
    const gen = lists(integers(0, 10));
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<number[]>).schema();
    expect(schema["type"]).toBe("list");
    expect(schema["elements"]).toEqual({ type: "integer", min_value: 0, max_value: 10 });
    expect(schema["min_size"]).toBe(0);
    expect(schema["max_size"]).toBeUndefined();
  });

  it("basic element, includes min_size and max_size in schema when provided", () => {
    const gen = lists(booleans(), 2, 5);
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<boolean[]>).schema();
    expect(schema["type"]).toBe("list");
    expect(schema["min_size"]).toBe(2);
    expect(schema["max_size"]).toBe(5);
  });

  it("basic element with transform: returns BasicGenerator (transform applied per item)", () => {
    const mappedElem = integers(0, 5).map((x) => x * 2);
    const gen = lists(mappedElem, 0, 3);
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<number[]>).schema();
    expect(schema["type"]).toBe("list");
    expect(schema["elements"]).toEqual({ type: "integer", min_value: 0, max_value: 5 });
  });

  it("non-basic element: returns CompositeListGenerator", () => {
    const filtered = integers(0, 10).filter((x) => x > 5);
    const gen = lists(filtered);
    expect(gen).toBeInstanceOf(CompositeListGenerator);
    expect(gen).not.toBeInstanceOf(BasicGenerator);
  });

  it("non-basic element (mapped via non-basic path): returns CompositeListGenerator", () => {
    const nonBasic = integers()
      .filter(() => true)
      .map((x) => x * 2);
    const gen = lists(nonBasic);
    expect(gen).toBeInstanceOf(CompositeListGenerator);
  });

  // --- E2E tests via live server ---

  it("lists(integers(0, 100)): all elements in range", async () => {
    await runHegelTest(
      async () => {
        const xs = await draw(lists(integers(0, 100)));
        if (!Array.isArray(xs)) throw new Error("Expected array");
        for (const x of xs) {
          if (typeof x !== "number" || x < 0 || x > 100) {
            throw new Error(`Element out of range: ${x}`);
          }
        }
      },
      { testCases: 50 },
    );
  });

  it("lists(booleans(), 3, 5): length in [3, 5] and all boolean", async () => {
    await runHegelTest(
      async () => {
        const xs = await draw(lists(booleans(), 3, 5));
        if (!Array.isArray(xs)) throw new Error("Expected array");
        if (xs.length < 3 || xs.length > 5) {
          throw new Error(`Expected length 3-5, got ${xs.length}`);
        }
        for (const x of xs) {
          if (typeof x !== "boolean") throw new Error(`Element not boolean: ${String(x)}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("basic element with transform via live server: transform applied to each item", async () => {
    await runHegelTest(
      async () => {
        const xs = await draw(
          lists(
            integers(0, 5).map((x) => x * 2),
            0,
            5,
          ),
        );
        if (!Array.isArray(xs)) throw new Error("Expected array");
        for (const x of xs) {
          if (typeof x !== "number" || x % 2 !== 0 || x < 0 || x > 10) {
            throw new Error(`Expected even number in [0,10], got ${x}`);
          }
        }
      },
      { testCases: 50 },
    );
  });

  it("non-basic elements: all > 5", async () => {
    await runHegelTest(
      async () => {
        const xs = await draw(
          lists(
            integers(0, 10).filter((x) => x > 5),
            1,
            5,
          ),
        );
        if (!Array.isArray(xs)) throw new Error("Expected array");
        if (xs.length < 1 || xs.length > 5) {
          throw new Error(`Expected length 1-5, got ${xs.length}`);
        }
        for (const x of xs) {
          if (typeof x !== "number" || x <= 5) {
            throw new Error(`Expected element > 5, got ${x}`);
          }
        }
      },
      { testCases: 50 },
    );
  });

  it("nested lists: list of lists of booleans", async () => {
    await runHegelTest(
      async () => {
        const xss = await draw(lists(lists(booleans(), 0, 3), 0, 3));
        if (!Array.isArray(xss)) throw new Error("Expected outer array");
        for (const xs of xss) {
          if (!Array.isArray(xs)) throw new Error("Expected inner array");
          for (const x of xs) {
            if (typeof x !== "boolean") throw new Error(`Inner element not boolean: ${String(x)}`);
          }
        }
      },
      { testCases: 50 },
    );
  });

  it("CompositeListGenerator with no max: returns a list of integers in range", async () => {
    await runHegelTest(
      async () => {
        const xs = await draw(lists(integers(0, 10).filter(() => true)));
        if (!Array.isArray(xs)) throw new Error("Expected array");
        for (const x of xs) {
          if (typeof x !== "number" || x < 0 || x > 10) {
            throw new Error(`Element out of range: ${x}`);
          }
        }
      },
      { testCases: 5 },
    );
  });

  it("stop_test_on_new_collection during CompositeListGenerator: DataExhausted propagates", async () => {
    const origMode = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_new_collection";
    const { HegelSession: HS } = await import("../../src/session.js");
    const session = new HS();
    try {
      await session.runTest(async () => {
        const xs = await draw(lists(integers(0, 10).filter(() => true)));
        void xs;
      }, 5);
    } finally {
      session._cleanup();
      if (origMode !== undefined) {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = origMode;
      } else {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      }
    }
  });

  it("stop_test_on_collection_more during CompositeListGenerator: DataExhausted propagates", async () => {
    const origMode = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_collection_more";
    const { HegelSession: HS } = await import("../../src/session.js");
    const session = new HS();
    try {
      await session.runTest(async () => {
        const xs = await draw(lists(integers(0, 10).filter(() => true)));
        void xs;
      }, 5);
    } finally {
      session._cleanup();
      if (origMode !== undefined) {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = origMode;
      } else {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      }
    }
  });
});
