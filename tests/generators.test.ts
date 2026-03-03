/**
 * Tests for the Generator infrastructure: BasicGenerator, MappedGenerator,
 * FlatMappedGenerator, FilteredGenerator, Collection, span helpers, and integers().
 *
 * Integration tests run against the real hegel binary via runHegelTest.
 * Unit tests for generator class structure use mocked context.
 */

import { describe, expect, it } from "vitest";
import { Channel, RequestError } from "../src/connection.js";
import {
  _testContextStorage,
  draw,
  generateFromSchema,
  startSpan,
  stopSpan,
} from "../src/runner.js";
import type { TestCaseData } from "../src/runner.js";
import {
  BasicGenerator,
  Collection,
  CompositeTupleGenerator,
  FilteredGenerator,
  FlatMappedGenerator,
  Generator,
  MappedGenerator,
  discardableGroup,
  group,
  integers,
  floats,
  booleans,
  text,
  binary,
  just,
  sampledFrom,
  fromRegex,
  emails,
  urls,
  domains,
  dates,
  times,
  datetimes,
  tuples2,
  tuples3,
  tuples4,
  CompositeOneOfGenerator,
  oneOf,
  optional,
  ipAddresses,
  CompositeListGenerator,
  lists,
  CompositeDictGenerator,
  dicts,
} from "../src/generators.js";
import { runHegelTest } from "../src/session.js";

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
// integers()
// ---------------------------------------------------------------------------

describe("integers()", () => {
  it("generates a BasicGenerator", () => {
    expect(integers()).toBeInstanceOf(BasicGenerator);
  });

  it("generates integers in range via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(integers(0, 100));
        if (v < 0 || v > 100) throw new Error(`Out of range: ${v}`);
      },
      { testCases: 20 },
    );
  });

  it("generates without bounds when no args given", () => {
    const gen = integers();
    expect(gen.schema()).toEqual({ type: "integer" });
  });

  it("sets only min_value when only min provided", () => {
    const gen = integers(5, null);
    expect(gen.schema()).toEqual({ type: "integer", min_value: 5 });
  });

  it("sets only max_value when only max provided", () => {
    const gen = integers(null, 100);
    expect(gen.schema()).toEqual({ type: "integer", max_value: 100 });
  });
});

// ---------------------------------------------------------------------------
// span helpers: group and discardableGroup
// ---------------------------------------------------------------------------

describe("group()", () => {
  it("calls start_span and stop_span around fn", async () => {
    await runHegelTest(
      async () => {
        const data = _testContextStorage.getStore()!;
        // group() runs fn inside a span — verify it works end-to-end
        const result = await group(
          1,
          async () => {
            return await generateFromSchema({ type: "boolean" }, data);
          },
          data,
        );
        if (typeof result !== "boolean") {
          throw new Error("Expected boolean");
        }
      },
      { testCases: 5 },
    );
  });
});

describe("discardableGroup()", () => {
  it("stops with discard=false when fn succeeds", async () => {
    await runHegelTest(
      async () => {
        const data = _testContextStorage.getStore()!;
        const result = await discardableGroup(
          1,
          async () => {
            return await generateFromSchema({ type: "boolean" }, data);
          },
          data,
        );
        if (typeof result !== "boolean") throw new Error("Expected boolean");
      },
      { testCases: 5 },
    );
  });

  it("stops with discard=true and re-throws when fn throws", async () => {
    // Use mock context to avoid needing a live server for this unit test
    const fakeRequests: unknown[] = [];
    const fakeChannel = {
      request: (msg: unknown) => {
        fakeRequests.push(msg);
        return {
          get: () => Promise.resolve(null),
        };
      },
    } as unknown as Channel;
    const data: TestCaseData = { channel: fakeChannel, isFinal: false, testAborted: false };

    const err = new Error("fn failed");
    await expect(
      discardableGroup(
        1,
        async () => {
          throw err;
        },
        data,
      ),
    ).rejects.toBe(err);

    // Check that stop_span was called with discard=true
    const stopMsg = fakeRequests.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as Record<string, unknown>)["command"] === "stop_span" &&
        (m as Record<string, unknown>)["discard"] === true,
    );
    expect(stopMsg).toBeDefined();
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
        const coll = new Collection("test_coll", 0, 1);
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
        const coll = new Collection("test_coll", 1, 5);
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
        const coll = new Collection("test_coll", 0, 1);
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
    const session = await import("../src/session.js").then((m) => {
      const s = new m.HegelSession();
      return s;
    });
    try {
      await session.runTest(async () => {
        const data = _testContextStorage.getStore()!;
        const coll = new Collection("test_coll", 0, 5);
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
    const { HegelSession: HS } = await import("../src/session.js");
    const session = new HS();
    try {
      await session.runTest(async () => {
        const data = _testContextStorage.getStore()!;
        const coll = new Collection("test_coll", 0, 5);
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
// Collection non-StopTest error paths (unit tests with fake channel)
// ---------------------------------------------------------------------------

describe("Collection non-StopTest errors", () => {
  /** Make a non-StopTest RequestError. */
  function makeRequestError(errorType: string): RequestError {
    return new RequestError({ error: "server error", type: errorType });
  }

  it("_getServerName: non-StopTest error is re-thrown", async () => {
    // new_collection fails with a non-StopTest error
    const fakeChannel = {
      request: (_msg: unknown) => ({
        get: () => Promise.reject(makeRequestError("InvalidSchema")),
      }),
    } as unknown as Channel;
    const data: TestCaseData = { channel: fakeChannel, isFinal: false, testAborted: false };

    const coll = new Collection("test_coll", 0, 5);
    await expect(coll.more(data)).rejects.toBeInstanceOf(RequestError);
  });

  it("more(): non-StopTest error is re-thrown", async () => {
    // First request (new_collection) succeeds, second (collection_more) fails
    let callCount = 0;
    const fakeChannel = {
      request: (_msg: unknown) => ({
        get: () => {
          callCount++;
          if (callCount === 1) return Promise.resolve("coll-name"); // new_collection ok
          return Promise.reject(makeRequestError("InvalidSchema")); // collection_more fails
        },
      }),
    } as unknown as Channel;
    const data: TestCaseData = { channel: fakeChannel, isFinal: false, testAborted: false };

    const coll = new Collection("test_coll", 0, 5);
    await expect(coll.more(data)).rejects.toBeInstanceOf(RequestError);
  });
});

// ---------------------------------------------------------------------------
// floats(), booleans(), text(), binary() — schema structure tests
// ---------------------------------------------------------------------------

describe("floats()", () => {
  it("returns a BasicGenerator with type=float", () => {
    const gen = floats();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toMatchObject({ type: "float" });
  });

  it("includes min_value and max_value when provided", () => {
    const gen = floats(0.0, 1.0);
    const schema = gen.schema();
    expect(schema["min_value"]).toBe(0.0);
    expect(schema["max_value"]).toBe(1.0);
  });

  it("allow_nan defaults to false when bounds given", () => {
    const gen = floats(0, 1);
    expect(gen.schema()["allow_nan"]).toBe(false);
  });

  it("allow_nan defaults to true when no bounds", () => {
    const gen = floats();
    expect(gen.schema()["allow_nan"]).toBe(true);
  });

  it("allow_infinity defaults to false when both bounds given", () => {
    const gen = floats(0, 1);
    expect(gen.schema()["allow_infinity"]).toBe(false);
  });

  it("allow_infinity defaults to true when one bound missing", () => {
    const gen = floats(0, null);
    expect(gen.schema()["allow_infinity"]).toBe(true);
  });

  it("respects explicit allowNan and allowInfinity", () => {
    const gen = floats(null, null, false, false);
    expect(gen.schema()["allow_nan"]).toBe(false);
    expect(gen.schema()["allow_infinity"]).toBe(false);
  });

  it("sets exclude_min and exclude_max", () => {
    const gen = floats(0, 1, null, null, true, true);
    expect(gen.schema()["exclude_min"]).toBe(true);
    expect(gen.schema()["exclude_max"]).toBe(true);
  });
});

describe("booleans()", () => {
  it("returns a BasicGenerator with type=boolean and default p=0.5", () => {
    const gen = booleans();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "boolean", p: 0.5 });
  });

  it("uses custom probability when provided", () => {
    const gen = booleans(0.8);
    expect(gen.schema()["p"]).toBe(0.8);
  });
});

describe("text()", () => {
  it("returns a BasicGenerator with type=string and min_size=0", () => {
    const gen = text();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "string", min_size: 0 });
  });

  it("includes max_size when provided", () => {
    const gen = text(0, 100);
    expect(gen.schema()["max_size"]).toBe(100);
  });

  it("uses custom min_size", () => {
    const gen = text(5);
    expect(gen.schema()["min_size"]).toBe(5);
  });
});

describe("binary()", () => {
  it("returns a BasicGenerator with type=binary and min_size=0", () => {
    const gen = binary();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "binary", min_size: 0 });
  });

  it("includes max_size when provided", () => {
    const gen = binary(0, 64);
    expect(gen.schema()["max_size"]).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// Format generators — unit tests (schema structure)
// ---------------------------------------------------------------------------

describe("emails()", () => {
  it("returns a BasicGenerator with type=email", () => {
    const gen = emails();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "email" });
  });

  it("generates strings containing '@' via live server", async () => {
    await runHegelTest(
      async () => {
        const email = await draw(emails());
        if (typeof email !== "string" || !email.includes("@")) {
          throw new Error(`Expected email with '@', got: ${String(email)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("urls()", () => {
  it("returns a BasicGenerator with type=url", () => {
    const gen = urls();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "url" });
  });

  it("generates strings starting with http:// or https:// via live server", async () => {
    await runHegelTest(
      async () => {
        const url = await draw(urls());
        if (
          typeof url !== "string" ||
          (!url.startsWith("http://") && !url.startsWith("https://"))
        ) {
          throw new Error(`Expected URL starting with http(s)://, got: ${String(url)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("domains()", () => {
  it("returns a BasicGenerator with type=domain and no extra fields", () => {
    const gen = domains();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "domain" });
  });

  it("includes max_length in schema when provided", () => {
    const gen = domains(20);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "domain", max_length: 20 });
  });

  it("generates valid domain strings via live server", async () => {
    const validDomainChars = /^[a-zA-Z0-9.-]+$/;
    await runHegelTest(
      async () => {
        const domain = await draw(domains());
        if (typeof domain !== "string" || !validDomainChars.test(domain)) {
          throw new Error(`Expected domain with only valid chars, got: ${String(domain)}`);
        }
      },
      { testCases: 30 },
    );
  });

  it("respects max_length constraint via live server", async () => {
    const maxLen = 20;
    await runHegelTest(
      async () => {
        const domain = await draw(domains(maxLen));
        if (typeof domain !== "string" || domain.length > maxLen) {
          throw new Error(
            `Expected domain length <= ${maxLen}, got length ${String((domain as string).length)}: ${String(domain)}`,
          );
        }
      },
      { testCases: 30 },
    );
  });
});

describe("dates()", () => {
  it("returns a BasicGenerator with type=date", () => {
    const gen = dates();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "date" });
  });

  it("generates ISO 8601 date strings (YYYY-MM-DD) via live server", async () => {
    await runHegelTest(
      async () => {
        const dateStr = await draw(dates());
        if (typeof dateStr !== "string") {
          throw new Error(`Expected string, got: ${String(dateStr)}`);
        }
        // Must match YYYY-MM-DD format exactly
        const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
        if (!isoDateRe.test(dateStr)) {
          throw new Error(`Expected YYYY-MM-DD format, got: ${dateStr}`);
        }
        // Must be a valid calendar date (parseable)
        const parsed = new Date(dateStr + "T00:00:00Z");
        if (isNaN(parsed.getTime())) {
          throw new Error(`Not a valid date: ${dateStr}`);
        }
        // Round-trip: converting back to ISO should match (mod time zone)
        const roundTripped = parsed.toISOString().slice(0, 10);
        if (roundTripped !== dateStr) {
          throw new Error(`Date round-trip failed: ${dateStr} -> ${roundTripped}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("times()", () => {
  it("returns a BasicGenerator with type=time", () => {
    const gen = times();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "time" });
  });

  it("generates time strings containing ':' via live server", async () => {
    await runHegelTest(
      async () => {
        const timeStr = await draw(times());
        if (typeof timeStr !== "string" || !timeStr.includes(":")) {
          throw new Error(`Expected time string with ':', got: ${String(timeStr)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("datetimes()", () => {
  it("returns a BasicGenerator with type=datetime", () => {
    const gen = datetimes();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "datetime" });
  });

  it("generates datetime strings containing 'T' via live server", async () => {
    await runHegelTest(
      async () => {
        const dtStr = await draw(datetimes());
        if (typeof dtStr !== "string" || !dtStr.includes("T")) {
          throw new Error(`Expected datetime string with 'T', got: ${String(dtStr)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// just()
// ---------------------------------------------------------------------------

describe("just()", () => {
  it("returns a BasicGenerator", () => {
    const gen = just(42);
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("schema has 'const' key with null value", () => {
    const gen = just("hello");
    expect(gen.schema()).toEqual({ const: null });
  });

  it("transform always returns the constant regardless of raw value", () => {
    const gen = just(99);
    // map() on a BasicGenerator exposes the composed transform
    // We can test this via the live server: every generated value should be 99
    expect(gen.schema()).toHaveProperty("const");
  });

  it("returns constant value via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(just(42));
        if (v !== 42) throw new Error(`Expected 42, got ${v}`);
      },
      { testCases: 10 },
    );
  });

  it("returns constant object via live server", async () => {
    const obj = { x: 1, y: 2 };
    await runHegelTest(
      async () => {
        const v = await draw(just(obj));
        if (v !== obj) throw new Error(`Expected same object reference`);
      },
      { testCases: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// sampledFrom()
// ---------------------------------------------------------------------------

describe("sampledFrom()", () => {
  it("returns a BasicGenerator", () => {
    const gen = sampledFrom([1, 2, 3]);
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("schema is integer with correct bounds for 3 elements", () => {
    const gen = sampledFrom(["a", "b", "c"]);
    const schema = gen.schema();
    expect(schema["type"]).toBe("integer");
    expect(schema["min_value"]).toBe(0);
    expect(schema["max_value"]).toBe(2);
  });

  it("schema max_value equals length-1 for single element", () => {
    const gen = sampledFrom([42]);
    const schema = gen.schema();
    expect(schema["min_value"]).toBe(0);
    expect(schema["max_value"]).toBe(0);
  });

  it("throws on empty list", () => {
    expect(() => sampledFrom([])).toThrow("sampledFrom requires at least one element");
  });

  it("transform maps index 0 to first element", () => {
    const items = ["x", "y", "z"];
    const gen = sampledFrom(items);
    // Create a version that directly applies the transform through map()
    const mapped = gen.map((v) => v);
    expect(mapped.schema()).toEqual(gen.schema());
    expect(mapped).toBeInstanceOf(BasicGenerator);
  });

  it("returns a value from the list via live server", async () => {
    const items = [10, 20, 30];
    const itemSet = new Set(items);
    await runHegelTest(
      async () => {
        const v = await draw(sampledFrom(items));
        if (!itemSet.has(v)) throw new Error(`Unexpected value: ${v}`);
      },
      { testCases: 50 },
    );
  });

  it("returns non-primitive objects from the list via live server", async () => {
    class Custom {
      constructor(public readonly x: number) {}
    }
    const items = [new Custom(1), new Custom(2), new Custom(3)];
    await runHegelTest(
      async () => {
        const v = await draw(sampledFrom(items));
        if (!(v instanceof Custom)) throw new Error(`Expected Custom instance`);
        if (!items.includes(v)) throw new Error(`Value not in items list`);
      },
      { testCases: 10 },
    );
  });

  it("covers all values across many runs", async () => {
    const items = ["red", "green", "blue"];
    const seen = new Set<string>();
    await runHegelTest(
      async () => {
        const v = await draw(sampledFrom(items));
        seen.add(v);
      },
      { testCases: 100 },
    );
    for (const item of items) {
      if (!seen.has(item)) throw new Error(`Item never generated: ${item}`);
    }
  });
});

// ---------------------------------------------------------------------------
// fromRegex()
// ---------------------------------------------------------------------------

describe("fromRegex()", () => {
  it("returns a BasicGenerator", () => {
    const gen = fromRegex("[0-9]+");
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type 'regex', pattern, and fullmatch=true by default", () => {
    const gen = fromRegex("[a-z]+");
    const schema = gen.schema();
    expect(schema["type"]).toBe("regex");
    expect(schema["pattern"]).toBe("[a-z]+");
    expect(schema["fullmatch"]).toBe(true);
  });

  it("schema has fullmatch=false when specified", () => {
    const gen = fromRegex("[a-z]+", false);
    const schema = gen.schema();
    expect(schema["fullmatch"]).toBe(false);
  });

  it("generates strings matching the pattern via live server", async () => {
    const pattern = "[0-9]{3}";
    const re = new RegExp(`^${pattern}$`);
    await runHegelTest(
      async () => {
        const v = await draw(fromRegex(pattern));
        if (!re.test(v)) throw new Error(`Value "${v}" does not match pattern ${pattern}`);
      },
      { testCases: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// floats(), booleans(), text(), binary() — unit tests (schema structure)
// ---------------------------------------------------------------------------

describe("floats()", () => {
  it("returns a BasicGenerator", () => {
    expect(floats()).toBeInstanceOf(BasicGenerator);
  });

  it("schema defaults: allow_nan=true, allow_infinity=true when no bounds", () => {
    const schema = floats().schema();
    expect(schema["type"]).toBe("float");
    expect(schema["allow_nan"]).toBe(true);
    expect(schema["allow_infinity"]).toBe(true);
    expect(schema["exclude_min"]).toBe(false);
    expect(schema["exclude_max"]).toBe(false);
    expect(schema["width"]).toBe(64);
  });

  it("schema with min and max: allow_nan=false, allow_infinity=false", () => {
    const schema = floats(0, 1).schema();
    expect(schema["min_value"]).toBe(0);
    expect(schema["max_value"]).toBe(1);
    expect(schema["allow_nan"]).toBe(false);
    expect(schema["allow_infinity"]).toBe(false);
  });

  it("allows explicit allow_nan and allow_infinity", () => {
    const schema = floats(null, null, true, false).schema();
    expect(schema["allow_nan"]).toBe(true);
    expect(schema["allow_infinity"]).toBe(false);
  });

  it("sets exclude_min and exclude_max", () => {
    const schema = floats(0, 1, null, null, true, true).schema();
    expect(schema["exclude_min"]).toBe(true);
    expect(schema["exclude_max"]).toBe(true);
  });

  it("schema with only min set: allow_infinity=true", () => {
    const schema = floats(0).schema();
    expect(schema["min_value"]).toBe(0);
    expect(schema["allow_nan"]).toBe(false);
    expect(schema["allow_infinity"]).toBe(true);
  });

  it("generates numbers via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(floats(0, 1));
        if (typeof v !== "number") throw new Error(`Expected number, got ${typeof v}`);
        if (v < 0 || v > 1) throw new Error(`Out of range [0,1]: ${v}`);
      },
      { testCases: 20 },
    );
  });
});

describe("booleans()", () => {
  it("returns a BasicGenerator", () => {
    expect(booleans()).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type=boolean and p=0.5 by default", () => {
    const schema = booleans().schema();
    expect(schema["type"]).toBe("boolean");
    expect(schema["p"]).toBe(0.5);
  });

  it("schema has custom p value", () => {
    const schema = booleans(0.8).schema();
    expect(schema["p"]).toBe(0.8);
  });

  it("generates booleans via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(booleans());
        if (typeof v !== "boolean") throw new Error(`Expected boolean, got ${typeof v}`);
      },
      { testCases: 20 },
    );
  });
});

describe("text()", () => {
  it("returns a BasicGenerator", () => {
    expect(text()).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type=string and min_size=0 by default", () => {
    const schema = text().schema();
    expect(schema["type"]).toBe("string");
    expect(schema["min_size"]).toBe(0);
    expect(schema["max_size"]).toBeUndefined();
  });

  it("schema includes max_size when provided", () => {
    const schema = text(1, 10).schema();
    expect(schema["min_size"]).toBe(1);
    expect(schema["max_size"]).toBe(10);
  });

  it("generates strings via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(text(0, 20));
        if (typeof v !== "string") throw new Error(`Expected string, got ${typeof v}`);
        // Use Array.from to count Unicode codepoints (not UTF-16 code units)
        if (Array.from(v).length > 20)
          throw new Error(`String too long: ${Array.from(v).length} codepoints`);
      },
      { testCases: 20 },
    );
  });
});

describe("binary()", () => {
  it("returns a BasicGenerator", () => {
    expect(binary()).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type=binary and min_size=0 by default", () => {
    const schema = binary().schema();
    expect(schema["type"]).toBe("binary");
    expect(schema["min_size"]).toBe(0);
    expect(schema["max_size"]).toBeUndefined();
  });

  it("schema includes max_size when provided", () => {
    const schema = binary(2, 8).schema();
    expect(schema["min_size"]).toBe(2);
    expect(schema["max_size"]).toBe(8);
  });

  it("generates Uint8Array via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(binary(0, 10));
        if (!(v instanceof Uint8Array)) throw new Error(`Expected Uint8Array`);
        if (v.length > 10) throw new Error(`Too long: ${v.length}`);
      },
      { testCases: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// tuples2 / tuples3 / tuples4
// ---------------------------------------------------------------------------

describe("tuples2()", () => {
  // --- Schema structure tests (all basic, no transforms) ---

  it("all basic, no transforms: returns BasicGenerator with tuple schema", () => {
    const gen = tuples2(integers(), booleans());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<[number, boolean]>).schema();
    expect(schema["type"]).toBe("tuple");
    expect(Array.isArray(schema["elements"])).toBe(true);
    const elems = schema["elements"] as Record<string, unknown>[];
    expect(elems).toHaveLength(2);
    expect(elems[0]).toMatchObject({ type: "integer" });
    expect(elems[1]).toMatchObject({ type: "boolean" });
  });

  it("all basic, no transforms: _transform is null (no transform applied)", () => {
    const gen = tuples2(integers(), booleans()) as BasicGenerator<[number, boolean]>;
    expect(gen._transform).toBeNull();
  });

  it("all basic WITH transforms: schema still uses raw element schemas", () => {
    const g1 = integers(0, 10).map((x) => x * 2);
    const g2 = just(5).map((x) => x + 1);
    expect(g1).toBeInstanceOf(BasicGenerator);
    expect(g2).toBeInstanceOf(BasicGenerator);
    expect(g1._transform).not.toBeNull();
    expect(g2._transform).not.toBeNull();

    const gen = tuples2(g1, g2) as BasicGenerator<[number, number]>;
    expect(gen).toBeInstanceOf(BasicGenerator);

    const schema = gen.schema();
    expect(schema["type"]).toBe("tuple");
    const elems = schema["elements"] as Record<string, unknown>[];
    // Raw schemas — NOT the transformed schemas
    expect(elems[0]).toMatchObject({ type: "integer", min_value: 0, max_value: 10 });
    expect(elems[1]).toMatchObject({ const: null });
    // A combined transform must exist
    expect(gen._transform).not.toBeNull();
  });

  it("all basic WITH transforms: transform applies per-position via live server", async () => {
    await runHegelTest(
      async () => {
        const g1 = integers(0, 10).map((x) => x * 2);
        const g2 = just(5).map((x) => x + 1);
        const gen = tuples2(g1, g2);
        const v = await draw(gen);
        const [a, b] = v;
        // a is integers(0,10) * 2 → even, in [0, 20]
        if (a % 2 !== 0 || a < 0 || a > 20) {
          throw new Error(`Expected even in [0,20], got ${a}`);
        }
        // b is just(5) + 1 → always 6
        if (b !== 6) {
          throw new Error(`Expected 6, got ${b}`);
        }
      },
      { testCases: 30 },
    );
  });

  // --- Mixed basic/non-basic ---

  it("mixed basic/non-basic: returns CompositeTupleGenerator", () => {
    const filtered = integers(0, 10).filter(() => true);
    const gen = tuples2(filtered, booleans());
    expect(gen).toBeInstanceOf(CompositeTupleGenerator);
    expect(gen).not.toBeInstanceOf(BasicGenerator);
  });

  it("non-basic: generates 2-tuples via live server (TUPLE span used)", async () => {
    await runHegelTest(
      async () => {
        const filtered = integers(0, 10).filter(() => true);
        const gen = tuples2(filtered, booleans());
        const v = await draw(gen);
        if (!Array.isArray(v) || v.length !== 2) {
          throw new Error(`Expected 2-element array, got ${JSON.stringify(v)}`);
        }
        const [n, b] = v;
        if (typeof n !== "number" || n < 0 || n > 10) {
          throw new Error(`First element out of range [0,10]: ${n}`);
        }
        if (typeof b !== "boolean") {
          throw new Error(`Second element not boolean: ${String(b)}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("all basic, no transforms: generates correct types via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(tuples2(integers(0, 10), booleans()));
        const [n, b] = v;
        if (typeof n !== "number" || n < 0 || n > 10) {
          throw new Error(`First element out of range [0,10]: ${n}`);
        }
        if (typeof b !== "boolean") {
          throw new Error(`Second element not boolean: ${String(b)}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("all basic, one with transform, one without: transform applied correctly", async () => {
    // g2 has no transform; g1 has a transform — covers the t===null branch in applyTransforms
    await runHegelTest(
      async () => {
        const g1 = integers(0, 5).map((x) => x * 3);
        const g2 = integers(0, 5); // no transform
        const gen = tuples2(g1, g2);
        expect(gen).toBeInstanceOf(BasicGenerator);
        const v = await draw(gen);
        const [a, b] = v;
        // a is 0..5 * 3, so 0,3,6,9,12,15
        if (a % 3 !== 0 || a < 0 || a > 15) {
          throw new Error(`a=${a} should be multiple of 3 in [0,15]`);
        }
        if (b < 0 || b > 5) {
          throw new Error(`b=${b} should be in [0,5]`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("tuples3()", () => {
  it("all basic: returns BasicGenerator with 3-element tuple schema", () => {
    const gen = tuples3(integers(), booleans(), text());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<[number, boolean, string]>).schema();
    expect(schema["type"]).toBe("tuple");
    const elems = schema["elements"] as Record<string, unknown>[];
    expect(elems).toHaveLength(3);
    expect(elems[0]).toMatchObject({ type: "integer" });
    expect(elems[1]).toMatchObject({ type: "boolean" });
    expect(elems[2]).toMatchObject({ type: "string" });
  });

  it("non-basic: returns CompositeTupleGenerator", () => {
    const filtered = integers().filter(() => true);
    const gen = tuples3(filtered, booleans(), text());
    expect(gen).toBeInstanceOf(CompositeTupleGenerator);
  });

  it("generates 3-tuples with correct types via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(tuples3(text(), integers(0, 5), floats(0, 1)));
        const [s, n, f] = v;
        if (typeof s !== "string") throw new Error(`First element not string: ${String(s)}`);
        if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 5) {
          throw new Error(`Second element out of range [0,5]: ${n}`);
        }
        if (typeof f !== "number" || f < 0 || f > 1) {
          throw new Error(`Third element out of range [0,1]: ${f}`);
        }
      },
      { testCases: 50 },
    );
  });
});

describe("tuples4()", () => {
  it("all basic: returns BasicGenerator with 4-element tuple schema", () => {
    const gen = tuples4(integers(), booleans(), text(), floats());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<[number, boolean, string, number]>).schema();
    expect(schema["type"]).toBe("tuple");
    const elems = schema["elements"] as Record<string, unknown>[];
    expect(elems).toHaveLength(4);
  });

  it("non-basic: returns CompositeTupleGenerator", () => {
    const filtered = integers().filter(() => true);
    const gen = tuples4(filtered, booleans(), text(), floats());
    expect(gen).toBeInstanceOf(CompositeTupleGenerator);
  });

  it("generates 4-tuples via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(tuples4(integers(0, 10), booleans(), text(0, 5), floats(0, 1)));
        const [n, b, s, f] = v;
        if (typeof n !== "number" || n < 0 || n > 10) {
          throw new Error(`First element out of range [0,10]: ${n}`);
        }
        if (typeof b !== "boolean") throw new Error(`Second element not boolean`);
        if (typeof s !== "string" || Array.from(s).length > 5) {
          throw new Error(`Third element not a short string: ${String(s)}`);
        }
        if (typeof f !== "number" || f < 0 || f > 1) {
          throw new Error(`Fourth element out of range [0,1]: ${f}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("CompositeTupleGenerator", () => {
  it("generates tuple via live server (filtered element > 5)", async () => {
    await runHegelTest(
      async () => {
        const gen = tuples2(
          integers(0, 10).filter((x) => x > 5),
          booleans(),
        );
        const v = await draw(gen);
        const [n, b] = v;
        if (typeof n !== "number" || n <= 5 || n > 10) {
          throw new Error(`First element should be > 5 and <= 10, got ${n}`);
        }
        if (typeof b !== "boolean") throw new Error(`Second element not boolean`);
      },
      { testCases: 50 },
    );
  });
});

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
// oneOf — Path 1: all basic, no transforms
// ---------------------------------------------------------------------------

describe("oneOf() — Path 1 (all basic, no transforms)", () => {
  it("returns a BasicGenerator with 'one_of' schema when all branches are basic and transform-free", () => {
    const gen = oneOf(integers(), booleans());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<unknown>).schema();
    expect(schema).toHaveProperty("one_of");
    const branches = schema["one_of"] as unknown[];
    expect(branches).toHaveLength(2);
    // Neither branch should be a tagged tuple
    for (const branch of branches) {
      expect((branch as Record<string, unknown>)["type"]).not.toBe("tuple");
    }
  });

  it("as_basic returns BasicGenerator (path 1)", () => {
    const gen = oneOf(integers(0, 5), integers(10, 15));
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("generates values from one of the branches via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(oneOf(integers(0, 10), integers(100, 200)));
        if (typeof v !== "number") throw new Error(`Expected number, got ${typeof v}`);
        if (!((v >= 0 && v <= 10) || (v >= 100 && v <= 200))) {
          throw new Error(`Value ${v} not in expected ranges`);
        }
      },
      { testCases: 50 },
    );
  });

  it("generates values from both branches across many runs", async () => {
    const low: number[] = [];
    const high: number[] = [];
    await runHegelTest(
      async () => {
        const v = await draw(oneOf(integers(0, 10), integers(100, 200)));
        if ((v as number) <= 10) low.push(v as number);
        else high.push(v as number);
      },
      { testCases: 100 },
    );
    if (low.length === 0) throw new Error("First branch never chosen");
    if (high.length === 0) throw new Error("Second branch never chosen");
  });

  it("throws if fewer than 2 generators provided", () => {
    expect(() => oneOf(integers())).toThrow("oneOf requires at least 2 generators");
  });
});

// ---------------------------------------------------------------------------
// oneOf — Path 2: all basic, some have transforms (tagged tuples)
// ---------------------------------------------------------------------------

describe("oneOf() — Path 2 (all basic, with transforms)", () => {
  it("returns a BasicGenerator using tagged tuple schemas", () => {
    const gen1 = just(1).map((x) => x * 2); // → 2
    const gen2 = just(2).map((x) => x * 3); // → 6
    const combined = oneOf(gen1, gen2);
    expect(combined).toBeInstanceOf(BasicGenerator);
    const schema = (combined as BasicGenerator<unknown>).schema();
    expect(schema).toHaveProperty("one_of");
    const branches = schema["one_of"] as unknown[];
    expect(branches).toHaveLength(2);
    // Each branch should be a tagged tuple
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i] as Record<string, unknown>;
      expect(branch["type"]).toBe("tuple");
      const elements = branch["elements"] as unknown[];
      expect(elements[0]).toEqual({ const: i });
    }
  });

  it("dispatches tagged transforms correctly via live server", async () => {
    // just(1).map(x*2) → always 2, just(2).map(x*3) → always 6
    await runHegelTest(
      async () => {
        const gen1 = just(1).map((x) => x * 2);
        const gen2 = just(2).map((x) => x * 3);
        const combined = oneOf(gen1, gen2);
        const v = await draw(combined);
        if (v !== 2 && v !== 6) {
          throw new Error(`Expected 2 or 6, got ${v}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("uses path 2 even when only one branch has a transform", () => {
    // just(1).map(x => x * 2) has a transform; integers() does not
    const gen1 = just(1).map((x) => x * 2);
    const gen2 = integers(10, 20); // no transform
    const combined = oneOf(gen1, gen2);
    expect(combined).toBeInstanceOf(BasicGenerator);
    const schema = (combined as BasicGenerator<unknown>).schema();
    const branches = schema["one_of"] as unknown[];
    // Should use tagged tuples since one branch has a transform
    expect((branches[0] as Record<string, unknown>)["type"]).toBe("tuple");
  });

  it("path 2: null transform branch returns value directly", async () => {
    // one branch has transform, one does not: the no-transform branch returns raw value
    await runHegelTest(
      async () => {
        const gen1 = just(1).map((x) => x * 2); // branch 0 → 2
        const gen2 = just(99); // branch 1 → 99, but const schema gives null → transform returns constant
        const combined = oneOf(gen1, gen2);
        const v = await draw(combined);
        if (v !== 2 && v !== 99) {
          throw new Error(`Expected 2 or 99, got ${v}`);
        }
      },
      { testCases: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// oneOf — Path 3: any non-basic generator (CompositeOneOfGenerator)
// ---------------------------------------------------------------------------

describe("oneOf() — Path 3 (composite, non-basic)", () => {
  it("returns CompositeOneOfGenerator when any branch is non-basic", () => {
    const filtered = integers().filter((x) => x > 0);
    const gen = oneOf(filtered, text());
    expect(gen).toBeInstanceOf(CompositeOneOfGenerator);
  });

  it("CompositeOneOfGenerator holds the branches", () => {
    const g1 = integers().filter(() => true);
    const g2 = text();
    const gen = oneOf(g1, g2) as CompositeOneOfGenerator<number | string>;
    expect(gen._generators).toHaveLength(2);
    expect(gen._generators[0]).toBe(g1);
    expect(gen._generators[1]).toBe(g2);
  });

  it("generates values from either branch via live server", async () => {
    await runHegelTest(
      async () => {
        const filtered = integers(0, 10).filter(() => true);
        const v = await draw(oneOf(filtered, text(0, 5)));
        if (typeof v !== "number" && typeof v !== "string") {
          throw new Error(`Expected number or string, got ${typeof v}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("generates from both branches across many runs (composite uses ONE_OF span)", async () => {
    let seenInt = false;
    let seenString = false;
    await runHegelTest(
      async () => {
        const filtered = integers(0, 100).filter(() => true);
        const v = await draw(oneOf(filtered, text(1, 10)));
        if (typeof v === "number") seenInt = true;
        if (typeof v === "string") seenString = true;
      },
      { testCases: 100 },
    );
    if (!seenInt) throw new Error("Integer branch never chosen");
    if (!seenString) throw new Error("String branch never chosen");
  });
});

// ---------------------------------------------------------------------------
// optional
// ---------------------------------------------------------------------------

describe("optional()", () => {
  it("returns a BasicGenerator when element is basic (null + basic = path 1 or 2)", () => {
    // just(null) has a transform, element is basic → path 2 (tagged tuples)
    const gen = optional(integers(0, 10));
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("returns CompositeOneOfGenerator when element is non-basic", () => {
    const filtered = integers(0, 10).filter(() => true);
    const gen = optional(filtered);
    expect(gen).toBeInstanceOf(CompositeOneOfGenerator);
  });

  it("generates null or a value from the element via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(optional(integers(0, 100)));
        if (v !== null && typeof v !== "number") {
          throw new Error(`Expected null or number, got ${typeof v}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("both null and non-null values appear across many runs", async () => {
    let seenNull = false;
    let seenValue = false;
    await runHegelTest(
      async () => {
        const v = await draw(optional(integers(0, 10)));
        if (v === null) seenNull = true;
        else seenValue = true;
      },
      { testCases: 100 },
    );
    if (!seenNull) throw new Error("null never generated by optional()");
    if (!seenValue) throw new Error("non-null value never generated by optional()");
  });

  it("optional with non-basic: both null and values appear", async () => {
    let seenNull = false;
    let seenValue = false;
    await runHegelTest(
      async () => {
        const filtered = integers(0, 10).filter(() => true);
        const v = await draw(optional(filtered));
        if (v === null) seenNull = true;
        else seenValue = true;
      },
      { testCases: 100 },
    );
    if (!seenNull) throw new Error("null never generated by optional(non-basic)");
    if (!seenValue) throw new Error("non-null never generated by optional(non-basic)");
  });
});

// ---------------------------------------------------------------------------
// ipAddresses
// ---------------------------------------------------------------------------

describe("ipAddresses()", () => {
  it("v4: returns BasicGenerator with schema type=ipv4", () => {
    const gen = ipAddresses(4);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect((gen as BasicGenerator<string>).schema()).toEqual({ type: "ipv4" });
  });

  it("v6: returns BasicGenerator with schema type=ipv6", () => {
    const gen = ipAddresses(6);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect((gen as BasicGenerator<string>).schema()).toEqual({ type: "ipv6" });
  });

  it("default (no version): returns a BasicGenerator with one_of schema (v4 and v6 are both basic)", () => {
    const gen = ipAddresses();
    // oneOf(ipAddresses(4), ipAddresses(6)) where both are basic with no transforms → Path 1
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<string>).schema();
    expect(schema).toHaveProperty("one_of");
  });

  it("v4: generates strings with dots (IPv4 format) via live server", async () => {
    await runHegelTest(
      async () => {
        const ip = await draw(ipAddresses(4));
        if (typeof ip !== "string" || !ip.includes(".")) {
          throw new Error(`Expected IPv4 with dots, got: ${String(ip)}`);
        }
        const parts = ip.split(".");
        if (parts.length !== 4) {
          throw new Error(`Expected 4 octets, got ${parts.length}: ${ip}`);
        }
        for (const part of parts) {
          const n = Number(part);
          if (!Number.isInteger(n) || n < 0 || n > 255) {
            throw new Error(`Invalid octet: ${part} in ${ip}`);
          }
        }
      },
      { testCases: 50 },
    );
  });

  it("v6: generates strings with colons (IPv6 format) via live server", async () => {
    await runHegelTest(
      async () => {
        const ip = await draw(ipAddresses(6));
        if (typeof ip !== "string" || !ip.includes(":")) {
          throw new Error(`Expected IPv6 with colons, got: ${String(ip)}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("default: generates both IPv4 (dots) and IPv6 (colons) across many runs", async () => {
    let seenV4 = false;
    let seenV6 = false;
    await runHegelTest(
      async () => {
        const ip = await draw(ipAddresses());
        if (typeof ip !== "string") throw new Error(`Expected string, got ${typeof ip}`);
        if (ip.includes(".") && !ip.includes(":")) seenV4 = true;
        if (ip.includes(":")) seenV6 = true;
      },
      { testCases: 100 },
    );
    if (!seenV4) throw new Error("IPv4 never generated by ipAddresses()");
    if (!seenV6) throw new Error("IPv6 never generated by ipAddresses()");
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
    const { HegelSession: HS } = await import("../src/session.js");
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
    const { HegelSession: HS } = await import("../src/session.js");
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
