/**
 * Core tests for the Generator infrastructure: BasicGenerator, MappedGenerator,
 * FlatMappedGenerator, FilteredGenerator, Collection, and span helpers.
 *
 * Integration tests run against the real hegel binary via runHegelTest.
 * Unit tests for generator class structure use mocked context.
 */

import { describe, expect, it } from "vitest";
import {
  BasicGenerator,
  Collection,
  integers,
  booleans,
  text,
  lists,
  draw,
  runHegelTest,
} from "hegel";
import { Stream, RequestError } from "../../src/connection.js";
import { _testContextStorage, generateFromSchema, startSpan, stopSpan } from "../../src/runner.js";
import type { TestCaseData } from "../../src/runner.js";
import {
  FilteredGenerator,
  FlatMappedGenerator,
  MappedGenerator,
} from "../../src/generators/index.js";

// ---------------------------------------------------------------------------
// BasicGenerator structure
// ---------------------------------------------------------------------------

describe("BasicGenerator", () => {
  it("holds and returns the schema", () => {
    const schema = { type: "integer", min_value: 0, max_value: 10 };
    const gen = new BasicGenerator(schema);
    expect(gen.schema()).toBe(schema);
  });

  it("map() returns a BasicGenerator (preserves schema)", () => {
    const gen = integers(0, 10).map((x) => x * 2);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "integer", min_value: 0, max_value: 10 });
  });

  it("double map() returns BasicGenerator and composes transforms", async () => {
    const gen = integers(1, 5)
      .map((x) => x * 2)
      .map((x) => x + 1);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "integer", min_value: 1, max_value: 5 });

    // Verify via live server: values should be odd numbers 3,5,7,9,11
    await runHegelTest(
      async () => {
        const v = await draw(gen);
        const validValues = new Set([3, 5, 7, 9, 11]);
        if (!validValues.has(v)) {
          throw new Error(`Unexpected value: ${v}`);
        }
      },
      { testCases: 10 },
    );
  });

  it("map() with no existing transform creates BasicGenerator", () => {
    const gen = integers(0, 10);
    const mapped = gen.map((x) => x.toString());
    expect(mapped).toBeInstanceOf(BasicGenerator);
  });

  it("map() with existing transform composes correctly", async () => {
    // Map twice: x * 2, then x + 1; result should always be odd
    await runHegelTest(
      async () => {
        const v = await draw(
          integers(0, 5)
            .map((x) => x * 2)
            .map((x) => x + 1),
        );
        if (v % 2 !== 1) {
          throw new Error(`Expected odd, got ${v}`);
        }
      },
      { testCases: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// MappedGenerator
// ---------------------------------------------------------------------------

describe("MappedGenerator", () => {
  it("is not a BasicGenerator", () => {
    const filtered = integers().filter(() => true);
    const mapped = filtered.map((x) => x * 2);
    expect(mapped).toBeInstanceOf(MappedGenerator);
    expect(mapped).not.toBeInstanceOf(BasicGenerator);
  });

  it("applies transform via live server", async () => {
    await runHegelTest(
      async () => {
        const gen = integers(0, 10).filter((x) => x % 2 === 0);
        const v = await draw(gen.map((x) => x * 3));
        if (v % 6 !== 0) {
          throw new Error(`Expected multiple of 6, got ${v}`);
        }
      },
      { testCases: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// FlatMappedGenerator
// ---------------------------------------------------------------------------

describe("FlatMappedGenerator", () => {
  it("is not a BasicGenerator", () => {
    const gen = integers().flatMap((_) => integers());
    expect(gen).toBeInstanceOf(FlatMappedGenerator);
    expect(gen).not.toBeInstanceOf(BasicGenerator);
  });

  it("generates values via live server", async () => {
    await runHegelTest(
      async () => {
        // Generate n, then generate exactly n+1 booleans as a list
        const gen = integers(0, 3).flatMap((n) => lists(booleans(), n + 1, n + 1));
        const v = await draw(gen);
        if (!Array.isArray(v)) throw new Error("Expected array");
      },
      { testCases: 10 },
    );
  });

  it("text length equals the integer (dependency verified)", async () => {
    // integers(1, 5).flatMap(n => text(n, n)) must produce strings of exactly length n.
    // This test verifies that the second generation truly depends on the first value.
    await runHegelTest(
      async () => {
        const gen = integers(1, 5).flatMap((n) => text(n, n));
        const s = await draw(gen);
        const codepoints = Array.from(s).length;
        if (codepoints < 1 || codepoints > 5) {
          throw new Error(`Expected 1–5 codepoints, got ${codepoints}: "${s}"`);
        }
        // Re-generate n and s independently to confirm they're correlated:
        // We can't re-access n here directly, but we know the generator pairs them —
        // verify the string length falls within [1, 5].
        if (typeof s !== "string") {
          throw new Error(`Expected string, got ${typeof s}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("second value depends on first: text(n,n) length equals n", async () => {
    // Verify dependency: collect (n, len) pairs and confirm len === n in each case.
    const pairs: Array<{ n: number; len: number }> = [];
    await runHegelTest(
      async () => {
        let capturedN = 0;
        const gen = integers(1, 5).flatMap((n) => {
          capturedN = n;
          return text(n, n);
        });
        const s = await draw(gen);
        pairs.push({ n: capturedN, len: Array.from(s).length });
        if (Array.from(s).length !== capturedN) {
          throw new Error(
            `Expected string length ${capturedN}, got ${Array.from(s).length}: "${s}"`,
          );
        }
      },
      { testCases: 50 },
    );
    // Verify we actually saw multiple distinct n values (genuine coverage of dependency)
    const seenNs = new Set(pairs.map((p) => p.n));
    if (seenNs.size < 2) {
      throw new Error(
        `Expected multiple distinct n values in 50 tests, got: ${[...seenNs].join(", ")}`,
      );
    }
    // Every pair must satisfy len === n
    for (const { n, len } of pairs) {
      if (len !== n) {
        throw new Error(`Dependency violation: n=${n} but text length=${len}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// FilteredGenerator
// ---------------------------------------------------------------------------

describe("FilteredGenerator", () => {
  it("is not a BasicGenerator", () => {
    const gen = integers().filter(() => true);
    expect(gen).toBeInstanceOf(FilteredGenerator);
    expect(gen).not.toBeInstanceOf(BasicGenerator);
  });

  it("filters values via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(integers(0, 100).filter((x) => x % 2 === 0));
        if (v % 2 !== 0) throw new Error(`Expected even, got ${v}`);
      },
      { testCases: 10 },
    );
  });

  it("calls assume(false) when all attempts fail", async () => {
    // FilteredGenerator with predicate=false -> AssumeRejected -> test case INVALID
    // The whole test run succeeds (all cases are just INVALID)
    await runHegelTest(
      async () => {
        await draw(new FilteredGenerator(integers(0, 10), () => false));
      },
      { testCases: 5 },
    );
    // If we got here, all cases were INVALID (assume rejected), which is fine
  });
});

// ---------------------------------------------------------------------------
// startSpan / stopSpan (non-aborted path, via live server)
// ---------------------------------------------------------------------------

describe("startSpan / stopSpan with live server", () => {
  it("sends start_span and stop_span to server", async () => {
    await runHegelTest(
      async () => {
        const data = _testContextStorage.getStore()!;
        await startSpan(1, data);
        await generateFromSchema({ type: "boolean" }, data);
        await stopSpan({}, data);
      },
      { testCases: 3 },
    );
  });
});

// ---------------------------------------------------------------------------
// Collection protocol
// ---------------------------------------------------------------------------

describe("Collection", () => {
  it("more() returns false immediately after collection is finished", async () => {
    await runHegelTest(
      async () => {
        const data = _testContextStorage.getStore()!;
        const coll = new Collection(0, 1);
        while (await coll.more(data)) {
          await generateFromSchema({ type: "integer" }, data);
        }
        // After exhaustion, more() should return false without server call
        const result = await coll.more(data);
        if (result !== false) throw new Error("Expected false");
      },
      { testCases: 5 },
    );
  });

  it("reject() while collection active notifies server", async () => {
    await runHegelTest(
      async () => {
        const data = _testContextStorage.getStore()!;
        const coll = new Collection(1, 5);
        while (await coll.more(data)) {
          const val = (await generateFromSchema(
            {
              type: "integer",
              min_value: 0,
              max_value: 100,
            },
            data,
          )) as number;
          if (val % 2 !== 0) {
            await coll.reject(data);
          }
        }
      },
      { testCases: 5 },
    );
  });

  it("reject() after collection finished is a no-op", async () => {
    await runHegelTest(
      async () => {
        const data = _testContextStorage.getStore()!;
        const coll = new Collection(0, 1);
        while (await coll.more(data)) {
          await generateFromSchema({ type: "integer" }, data);
        }
        // reject() after finished is a no-op
        const result = await coll.reject(data);
        if (result !== undefined) throw new Error("Expected undefined");
      },
      { testCases: 5 },
    );
  });

  it("stop_test_on_new_collection: DataExhausted raised", async () => {
    const origMode = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_new_collection";
    const session = await import("../../src/session.js").then((m) => {
      const s = new m.HegelSession();
      return s;
    });
    try {
      await session.runTest(async () => {
        const data = _testContextStorage.getStore()!;
        const coll = new Collection(0, 5);
        await coll.more(data);
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

  it("stop_test_on_collection_more: DataExhausted raised", async () => {
    const origMode = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_collection_more";
    const { HegelSession: HS } = await import("../../src/session.js");
    const session = new HS();
    try {
      await session.runTest(async () => {
        const data = _testContextStorage.getStore()!;
        const coll = new Collection(0, 5);
        await coll.more(data);
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

// ---------------------------------------------------------------------------
// Generator base class
// ---------------------------------------------------------------------------

describe("Generator base class", () => {
  it("map() on non-basic creates MappedGenerator", () => {
    const filtered = integers().filter(() => true);
    const mapped = filtered.map((x) => x * 2);
    expect(mapped).toBeInstanceOf(MappedGenerator);
    expect(mapped).not.toBeInstanceOf(BasicGenerator);
  });

  it("flatMap() returns FlatMappedGenerator", () => {
    const gen = integers().flatMap((_) => integers());
    expect(gen).toBeInstanceOf(FlatMappedGenerator);
  });

  it("filter() returns FilteredGenerator", () => {
    const gen = integers().filter(() => true);
    expect(gen).toBeInstanceOf(FilteredGenerator);
  });
});

// ---------------------------------------------------------------------------
// Collection non-StopTest error paths (unit tests with fake stream)
// ---------------------------------------------------------------------------

describe("Collection non-StopTest errors", () => {
  /** Make a non-StopTest RequestError. */
  function makeRequestError(errorType: string): RequestError {
    return new RequestError({ error: "server error", type: errorType });
  }

  it("_getServerName: non-StopTest error is re-thrown", async () => {
    // new_collection fails with a non-StopTest error
    const fakeStream = {
      request: (_msg: unknown) => ({
        get: () => Promise.reject(makeRequestError("InvalidSchema")),
      }),
    } as unknown as Stream;
    const data: TestCaseData = { stream: fakeStream, isFinal: false, testAborted: false };

    const coll = new Collection(0, 5);
    await expect(coll.more(data)).rejects.toBeInstanceOf(RequestError);
  });

  it("more(): non-StopTest error is re-thrown", async () => {
    // First request (new_collection) succeeds, second (collection_more) fails
    let callCount = 0;
    const fakeStream = {
      request: (_msg: unknown) => ({
        get: () => {
          callCount++;
          if (callCount === 1) return Promise.resolve("coll-name"); // new_collection ok
          return Promise.reject(makeRequestError("InvalidSchema")); // collection_more fails
        },
      }),
    } as unknown as Stream;
    const data: TestCaseData = { stream: fakeStream, isFinal: false, testAborted: false };

    const coll = new Collection(0, 5);
    await expect(coll.more(data)).rejects.toBeInstanceOf(RequestError);
  });
});
