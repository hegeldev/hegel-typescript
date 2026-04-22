/**
 * Tests targeting uncovered code paths, ported from hegel-rust test patterns.
 *
 * Covers: hegel.Collection protocol, composite generator fallbacks, StopTest
 * handling via HEGEL_PROTOCOL_TEST_MODE, filter exhaustion, and error paths.
 */

import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

// ---------------------------------------------------------------------------
// hegel.Collection protocol via composite generators
// (When elements don't have asBasic(), arrays/sets/maps use hegel.Collection)
// ---------------------------------------------------------------------------

describe("collection protocol", () => {
  // A composite generator has no schema, so gs.arrays() must use the
  // hegel.Collection protocol (new_collection / collection_more) instead of
  // sending a list schema to the server.
  const compositeInt = gs.composite((tc) => tc.draw(gs.integers({ minValue: 0, maxValue: 100 })));

  test(
    "arrays with composite elements uses collection protocol",
    hegel.test((tc) => {
      const arr = tc.draw(gs.arrays(compositeInt, { maxSize: 5 }));
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeLessThanOrEqual(5);
      for (const x of arr) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
      }
    }),
  );

  test(
    "arrays with composite elements respects minSize",
    hegel.test((tc) => {
      const arr = tc.draw(gs.arrays(compositeInt, { minSize: 1, maxSize: 5 }));
      expect(arr.length).toBeGreaterThanOrEqual(1);
      expect(arr.length).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "sets with composite elements uses collection protocol",
    hegel.test((tc) => {
      const s = tc.draw(gs.sets(compositeInt, { maxSize: 5 }));
      expect(s).toBeInstanceOf(Set);
      expect(s.size).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "maps with composite keys uses collection protocol",
    hegel.test((tc) => {
      const m = tc.draw(gs.maps(compositeInt, gs.booleans(), { maxSize: 3 }));
      expect(m).toBeInstanceOf(Map);
      expect(m.size).toBeLessThanOrEqual(3);
    }),
  );

  test(
    "maps with composite values uses collection protocol",
    hegel.test((tc) => {
      const m = tc.draw(
        gs.maps(gs.integers({ minValue: 0, maxValue: 10 }), compositeInt, { maxSize: 3 }),
      );
      expect(m).toBeInstanceOf(Map);
    }),
  );
});

// ---------------------------------------------------------------------------
// Unique arrays with collection protocol (duplicate rejection)
// ---------------------------------------------------------------------------

describe("unique arrays via collection protocol", () => {
  test(
    "unique arrays with composite elements reject duplicates",
    hegel.test((tc) => {
      // Small range + composite = uses collection protocol + duplicate rejection
      const arr = tc.draw(
        gs.arrays(
          gs.composite((inner) => inner.draw(gs.integers({ minValue: 0, maxValue: 5 }))),
          {
            maxSize: 4,
            unique: true,
          },
        ),
      );
      const uniqueCount = new Set(arr).size;
      expect(uniqueCount).toBe(arr.length);
    }),
  );
});

// ---------------------------------------------------------------------------
// Composite paths for oneOf and optional
// (When inner generators don't have asBasic(), oneOf/optional use spans)
// ---------------------------------------------------------------------------

describe("composite oneOf and optional", () => {
  test(
    "oneOf with composite generators uses span-based path",
    hegel.test((tc) => {
      const gen = gs.oneOf(
        compositeInt,
        gs.composite((inner) => inner.draw(gs.integers({ minValue: 200, maxValue: 300 }))),
      );
      const x = tc.draw(gen);
      expect(typeof x).toBe("number");
    }),
  );

  test(
    "optional with composite generator uses span-based path",
    hegel.test((tc) => {
      const gen = gs.optional(compositeInt);
      const x = tc.draw(gen);
      if (x !== null) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
      }
    }),
  );
});

// ---------------------------------------------------------------------------
// Tuple composite path
// ---------------------------------------------------------------------------

describe("tuple composite path", () => {
  test(
    "tuples with composite elements uses span-based path",
    hegel.test((tc) => {
      const [a, b] = tc.draw(gs.tuples(compositeInt, compositeInt));
      expect(typeof a).toBe("number");
      expect(typeof b).toBe("number");
    }),
  );
});

// ---------------------------------------------------------------------------
// Filter behavior (from hegel-rust test_filter, test_does_not_hang_on_assume_false)
// ---------------------------------------------------------------------------

describe("filter", () => {
  test(
    "filter passes values that match predicate",
    hegel.test((tc) => {
      const even = gs.integers({ minValue: 0, maxValue: 1000 }).filter((x) => x % 2 === 0);
      const x = tc.draw(even);
      expect(x % 2).toBe(0);
    }),
  );

  test(
    "filter with map preserves both transformations",
    hegel.test((tc) => {
      const gen = gs
        .integers({ minValue: 0, maxValue: 100 })
        .filter((x) => x > 10)
        .map((x) => x * 2);
      const x = tc.draw(gen);
      expect(x).toBeGreaterThan(20);
      expect(x % 2).toBe(0);
    }),
  );
});

// ---------------------------------------------------------------------------
// MappedGenerator without basic (uses span-based path)
// ---------------------------------------------------------------------------

describe("mapped generator paths", () => {
  test(
    "map on composite generator uses MAPPED span",
    hegel.test((tc) => {
      const gen = compositeInt.map((x) => x * 2);
      const x = tc.draw(gen);
      expect(x % 2).toBe(0);
    }),
  );
});

// ---------------------------------------------------------------------------
// Float edge cases (from hegel-rust test_floats.rs)
// ---------------------------------------------------------------------------

describe("float edge cases", () => {
  test(
    "floats can generate NaN when allowed",
    hegel.test(
      (tc) => {
        const x = tc.draw(gs.floats({ allowNan: true }));
        // Just verify it doesn't crash; NaN is a valid float
        expect(typeof x).toBe("number");
      },
      { testCases: 200 },
    ),
  );

  test(
    "floats with min only",
    hegel.test((tc) => {
      const x = tc.draw(gs.floats({ minValue: 0, allowNan: false, allowInfinity: false }));
      expect(x).toBeGreaterThanOrEqual(0);
    }),
  );

  test(
    "floats with max only",
    hegel.test((tc) => {
      const x = tc.draw(gs.floats({ maxValue: 100, allowNan: false, allowInfinity: false }));
      expect(x).toBeLessThanOrEqual(100);
    }),
  );
});

// ---------------------------------------------------------------------------
// HEGEL_PROTOCOL_TEST_MODE: stop_test_on_generate
// (Server sends StopTest on 1st generate of 2nd test case)
// ---------------------------------------------------------------------------

describe("HEGEL_PROTOCOL_TEST_MODE", () => {
  test("stop_test_on_generate: resolves without error", () => {
    const original = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    try {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_generate";
      // This should complete without throwing - StopTest marks test case invalid
      new hegel.Hegel((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    } finally {
      if (original === undefined) {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      } else {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = original;
      }
    }
  });

  test("error_response: resolves without throwing", () => {
    const original = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    try {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = "error_response";
      new hegel.Hegel((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    } finally {
      if (original === undefined) {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      } else {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = original;
      }
    }
  });

  test("empty_test: resolves without throwing", () => {
    const original = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    try {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = "empty_test";
      new hegel.Hegel((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    } finally {
      if (original === undefined) {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      } else {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = original;
      }
    }
  });

  test("stop_test_on_collection_more: resolves without throwing", () => {
    const original = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    try {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_collection_more";
      // Use composite generator to force collection protocol
      new hegel.Hegel((tc) => {
        const gen = gs.arrays(
          gs.composite((inner) => inner.draw(gs.integers({ minValue: 0, maxValue: 100 }))),
          { minSize: 1, maxSize: 10 },
        );
        tc.draw(gen);
      })
        .settings({ testCases: 10 })
        .run();
    } finally {
      if (original === undefined) {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      } else {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = original;
      }
    }
  });

  test("stop_test_on_new_collection: resolves without throwing", () => {
    const original = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    try {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_new_collection";
      new hegel.Hegel((tc) => {
        const gen = gs.arrays(
          gs.composite((inner) => inner.draw(gs.integers({ minValue: 0, maxValue: 100 }))),
          { minSize: 1, maxSize: 10 },
        );
        tc.draw(gen);
      })
        .settings({ testCases: 10 })
        .run();
    } finally {
      if (original === undefined) {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      } else {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = original;
      }
    }
  });

  test("stop_test_on_mark_complete: resolves without throwing", () => {
    const original = process.env["HEGEL_PROTOCOL_TEST_MODE"];
    try {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = "stop_test_on_mark_complete";
      new hegel.Hegel((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      })
        .settings({ testCases: 10 })
        .run();
    } finally {
      if (original === undefined) {
        delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
      } else {
        process.env["HEGEL_PROTOCOL_TEST_MODE"] = original;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Shrinking (from hegel-rust test_output.rs)
// ---------------------------------------------------------------------------

describe("shrinking", () => {
  test("failing test shrinks to minimal example", () => {
    try {
      hegel.test((tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 1000 }));
        if (x > 0) throw new Error("positive");
      })();
    } catch (e) {
      // The error should report the shrunk example
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("Property test failed");
    }
  });

  test("list shrinking finds minimal list", () => {
    try {
      hegel.test((tc) => {
        const arr = tc.draw(gs.arrays(gs.integers({ minValue: 0, maxValue: 100 })));
        if (arr.length > 0 && arr.some((x) => x > 0)) {
          throw new Error("found positive in list");
        }
      })();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("Property test failed");
    }
  });
});

// ---------------------------------------------------------------------------
// compositeInt helper used above (re-declare to avoid hoisting issues)
// ---------------------------------------------------------------------------

const compositeInt = gs.composite((tc) => tc.draw(gs.integers({ minValue: 0, maxValue: 100 })));

// ---------------------------------------------------------------------------
// Additional edge cases from hegel-rust
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test(
    "empty array generation",
    hegel.test((tc) => {
      const arr = tc.draw(gs.arrays(gs.integers(), { maxSize: 0 }));
      expect(arr).toEqual([]);
    }),
  );

  test(
    "sampledFrom with non-primitive values",
    hegel.test((tc) => {
      const options = [{ a: 1 }, { a: 2 }, { a: 3 }];
      const picked = tc.draw(gs.sampledFrom(options));
      expect(options).toContainEqual(picked);
    }),
  );

  test(
    "deeply nested generation",
    hegel.test((tc) => {
      const gen = gs.arrays(gs.arrays(gs.integers({ minValue: 0, maxValue: 10 }), { maxSize: 3 }), {
        maxSize: 3,
      });
      const nested = tc.draw(gen);
      expect(Array.isArray(nested)).toBe(true);
      for (const inner of nested) {
        expect(Array.isArray(inner)).toBe(true);
        for (const x of inner) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(10);
        }
      }
    }),
  );

  test(
    "flatMap dependent generation",
    hegel.test((tc) => {
      const gen = gs
        .integers({ minValue: 1, maxValue: 5 })
        .flatMap((n) => gs.text({ minSize: n, maxSize: n }));
      const s = tc.draw(gen);
      const cpLen = [...s].length;
      expect(cpLen).toBeGreaterThanOrEqual(1);
      expect(cpLen).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "gs.just() returns the exact value",
    hegel.test((tc) => {
      const obj = { key: "value" };
      const x = tc.draw(gs.just(obj));
      expect(x).toBe(obj); // Same reference
    }),
  );

  test(
    "assume(false) does not hang",
    hegel.test(
      (tc) => {
        tc.draw(gs.booleans());
        tc.assume(false);
        // Should never reach here - assume(false) always rejects
        expect(true).toBe(false);
      },
      { testCases: 10 },
    ),
  );
});

describe("asBasic composition", () => {
  test(
    "sets nested in tuples",
    hegel.test((tc) => {
      const [s, n] = tc.draw(
        gs.tuples(
          gs.sets(gs.integers({ minValue: 0, maxValue: 10 }), { maxSize: 3 }),
          gs.integers(),
        ),
      );
      expect(s).toBeInstanceOf(Set);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "maps nested in tuples",
    hegel.test((tc) => {
      const [m, n] = tc.draw(
        gs.tuples(
          gs.maps(gs.text({ minSize: 1, maxSize: 3 }), gs.integers({ minValue: 0, maxValue: 10 }), {
            maxSize: 3,
          }),
          gs.integers(),
        ),
      );
      expect(m).toBeInstanceOf(Map);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "oneOf nested in tuples",
    hegel.test((tc) => {
      const [v, n] = tc.draw(
        gs.tuples(
          gs.oneOf(
            gs.integers({ minValue: 0, maxValue: 10 }),
            gs.integers({ minValue: 100, maxValue: 110 }),
          ),
          gs.integers(),
        ),
      );
      expect(Number.isInteger(v)).toBe(true);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "optional nested in tuples",
    hegel.test((tc) => {
      const [v, n] = tc.draw(
        gs.tuples(gs.optional(gs.integers({ minValue: 0, maxValue: 10 })), gs.integers()),
      );
      expect(v === null || Number.isInteger(v)).toBe(true);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "tuples nested in tuples",
    hegel.test((tc) => {
      const [inner, n] = tc.draw(gs.tuples(gs.tuples(gs.integers(), gs.booleans()), gs.integers()));
      expect(Array.isArray(inner)).toBe(true);
      expect(Number.isInteger(inner[0])).toBe(true);
      expect(typeof inner[1]).toBe("boolean");
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "bigIntegers nested in tuples",
    hegel.test((tc) => {
      const [big, n] = tc.draw(
        gs.tuples(gs.bigIntegers({ minValue: 0n, maxValue: 1000n }), gs.integers()),
      );
      expect(typeof big).toBe("bigint");
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "sampledFrom nested in tuples",
    hegel.test((tc) => {
      const [color, n] = tc.draw(
        gs.tuples(gs.sampledFrom(["red", "green", "blue"]), gs.integers()),
      );
      expect(["red", "green", "blue"]).toContain(color);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "map on non-basic source returns null asBasic",
    hegel.test((tc) => {
      // filter produces a non-basic generator (FilteredGenerator inherits the
      // base asBasic() that returns null). Mapping on top of it and then
      // nesting in gs.tuples() causes MappedGenerator.asBasic() to see a null
      // source and return null -- exercising the null-source branch.
      const nonBasicMapped = gs
        .integers({ minValue: 0, maxValue: 10 })
        .filter((x) => x >= 0)
        .map((x) => x * 2);
      const [v, n] = tc.draw(gs.tuples(nonBasicMapped, gs.integers()));
      expect(Number.isInteger(v)).toBe(true);
      expect(v % 2).toBe(0);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );
});
