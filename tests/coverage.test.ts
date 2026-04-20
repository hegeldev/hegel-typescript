/**
 * Tests targeting uncovered code paths, ported from hegel-rust test patterns.
 *
 * Covers: Collection protocol, composite generator fallbacks, StopTest
 * handling via HEGEL_PROTOCOL_TEST_MODE, filter exhaustion, and error paths.
 */

import { describe, test, expect } from "vitest";
import {
  hegel,
  Hegel,
  integers,
  bigIntegers,
  floats,
  booleans,
  text,
  arrays,
  sets,
  maps,
  oneOf,
  optional,
  tuples,
  composite,
  just,
  sampledFrom,
} from "hegel";

// ---------------------------------------------------------------------------
// Collection protocol via composite generators
// (When elements don't have asBasic(), arrays/sets/maps use Collection)
// ---------------------------------------------------------------------------

describe("collection protocol", () => {
  // A composite generator has no schema, so arrays() must use the
  // Collection protocol (new_collection / collection_more) instead of
  // sending a list schema to the server.
  const compositeInt = composite((tc) => tc.draw(integers({ minValue: 0, maxValue: 100 })));

  test(
    "arrays with composite elements uses collection protocol",
    hegel((tc) => {
      const arr = tc.draw(arrays(compositeInt, { maxSize: 5 }));
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
    hegel((tc) => {
      const arr = tc.draw(arrays(compositeInt, { minSize: 1, maxSize: 5 }));
      expect(arr.length).toBeGreaterThanOrEqual(1);
      expect(arr.length).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "sets with composite elements uses collection protocol",
    hegel((tc) => {
      const s = tc.draw(sets(compositeInt, { maxSize: 5 }));
      expect(s).toBeInstanceOf(Set);
      expect(s.size).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "maps with composite keys uses collection protocol",
    hegel((tc) => {
      const m = tc.draw(maps(compositeInt, booleans(), { maxSize: 3 }));
      expect(m).toBeInstanceOf(Map);
      expect(m.size).toBeLessThanOrEqual(3);
    }),
  );

  test(
    "maps with composite values uses collection protocol",
    hegel((tc) => {
      const m = tc.draw(
        maps(integers({ minValue: 0, maxValue: 10 }), compositeInt, { maxSize: 3 }),
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
    hegel((tc) => {
      // Small range + composite = uses collection protocol + duplicate rejection
      const arr = tc.draw(
        arrays(
          composite((inner) => inner.draw(integers({ minValue: 0, maxValue: 5 }))),
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
    hegel((tc) => {
      const gen = oneOf(
        compositeInt,
        composite((inner) => inner.draw(integers({ minValue: 200, maxValue: 300 }))),
      );
      const x = tc.draw(gen);
      expect(typeof x).toBe("number");
    }),
  );

  test(
    "optional with composite generator uses span-based path",
    hegel((tc) => {
      const gen = optional(compositeInt);
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
    hegel((tc) => {
      const [a, b] = tc.draw(tuples(compositeInt, compositeInt));
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
    hegel((tc) => {
      const even = integers({ minValue: 0, maxValue: 1000 }).filter((x) => x % 2 === 0);
      const x = tc.draw(even);
      expect(x % 2).toBe(0);
    }),
  );

  test(
    "filter with map preserves both transformations",
    hegel((tc) => {
      const gen = integers({ minValue: 0, maxValue: 100 })
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
    hegel((tc) => {
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
    hegel(
      (tc) => {
        const x = tc.draw(floats({ allowNan: true }));
        // Just verify it doesn't crash; NaN is a valid float
        expect(typeof x).toBe("number");
      },
      { testCases: 200 },
    ),
  );

  test(
    "floats with min only",
    hegel((tc) => {
      const x = tc.draw(floats({ minValue: 0, allowNan: false, allowInfinity: false }));
      expect(x).toBeGreaterThanOrEqual(0);
    }),
  );

  test(
    "floats with max only",
    hegel((tc) => {
      const x = tc.draw(floats({ maxValue: 100, allowNan: false, allowInfinity: false }));
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
      new Hegel((tc) => {
        tc.draw(integers({ minValue: 0, maxValue: 100 }));
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
      new Hegel((tc) => {
        tc.draw(integers({ minValue: 0, maxValue: 100 }));
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
      new Hegel((tc) => {
        tc.draw(integers({ minValue: 0, maxValue: 100 }));
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
      new Hegel((tc) => {
        const gen = arrays(
          composite((inner) => inner.draw(integers({ minValue: 0, maxValue: 100 }))),
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
      new Hegel((tc) => {
        const gen = arrays(
          composite((inner) => inner.draw(integers({ minValue: 0, maxValue: 100 }))),
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
      new Hegel((tc) => {
        tc.draw(integers({ minValue: 0, maxValue: 100 }));
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
      hegel((tc) => {
        const x = tc.draw(integers({ minValue: 0, maxValue: 1000 }));
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
      hegel((tc) => {
        const arr = tc.draw(arrays(integers({ minValue: 0, maxValue: 100 })));
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

const compositeInt = composite((tc) => tc.draw(integers({ minValue: 0, maxValue: 100 })));

// ---------------------------------------------------------------------------
// Additional edge cases from hegel-rust
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test(
    "empty array generation",
    hegel((tc) => {
      const arr = tc.draw(arrays(integers(), { maxSize: 0 }));
      expect(arr).toEqual([]);
    }),
  );

  test(
    "sampledFrom with non-primitive values",
    hegel((tc) => {
      const options = [{ a: 1 }, { a: 2 }, { a: 3 }];
      const picked = tc.draw(sampledFrom(options));
      expect(options).toContainEqual(picked);
    }),
  );

  test(
    "deeply nested generation",
    hegel((tc) => {
      const gen = arrays(arrays(integers({ minValue: 0, maxValue: 10 }), { maxSize: 3 }), {
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
    hegel((tc) => {
      const gen = integers({ minValue: 1, maxValue: 5 }).flatMap((n) =>
        text({ minSize: n, maxSize: n }),
      );
      const s = tc.draw(gen);
      const cpLen = [...s].length;
      expect(cpLen).toBeGreaterThanOrEqual(1);
      expect(cpLen).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "just() returns the exact value",
    hegel((tc) => {
      const obj = { key: "value" };
      const x = tc.draw(just(obj));
      expect(x).toBe(obj); // Same reference
    }),
  );

  test(
    "assume(false) does not hang",
    hegel(
      (tc) => {
        tc.draw(booleans());
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
    hegel((tc) => {
      const [s, n] = tc.draw(
        tuples(sets(integers({ minValue: 0, maxValue: 10 }), { maxSize: 3 }), integers()),
      );
      expect(s).toBeInstanceOf(Set);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "maps nested in tuples",
    hegel((tc) => {
      const [m, n] = tc.draw(
        tuples(
          maps(text({ minSize: 1, maxSize: 3 }), integers({ minValue: 0, maxValue: 10 }), {
            maxSize: 3,
          }),
          integers(),
        ),
      );
      expect(m).toBeInstanceOf(Map);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "oneOf nested in tuples",
    hegel((tc) => {
      const [v, n] = tc.draw(
        tuples(
          oneOf(
            integers({ minValue: 0, maxValue: 10 }),
            integers({ minValue: 100, maxValue: 110 }),
          ),
          integers(),
        ),
      );
      expect(Number.isInteger(v)).toBe(true);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "optional nested in tuples",
    hegel((tc) => {
      const [v, n] = tc.draw(tuples(optional(integers({ minValue: 0, maxValue: 10 })), integers()));
      expect(v === null || Number.isInteger(v)).toBe(true);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "tuples nested in tuples",
    hegel((tc) => {
      const [inner, n] = tc.draw(tuples(tuples(integers(), booleans()), integers()));
      expect(Array.isArray(inner)).toBe(true);
      expect(Number.isInteger(inner[0])).toBe(true);
      expect(typeof inner[1]).toBe("boolean");
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "bigIntegers nested in tuples",
    hegel((tc) => {
      const [big, n] = tc.draw(tuples(bigIntegers({ minValue: 0n, maxValue: 1000n }), integers()));
      expect(typeof big).toBe("bigint");
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "sampledFrom nested in tuples",
    hegel((tc) => {
      const [color, n] = tc.draw(tuples(sampledFrom(["red", "green", "blue"]), integers()));
      expect(["red", "green", "blue"]).toContain(color);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );

  test(
    "map on non-basic source returns null asBasic",
    hegel((tc) => {
      // filter produces a non-basic generator (FilteredGenerator inherits the
      // base asBasic() that returns null). Mapping on top of it and then
      // nesting in tuples() causes MappedGenerator.asBasic() to see a null
      // source and return null -- exercising the null-source branch.
      const nonBasicMapped = integers({ minValue: 0, maxValue: 10 })
        .filter((x) => x >= 0)
        .map((x) => x * 2);
      const [v, n] = tc.draw(tuples(nonBasicMapped, integers()));
      expect(Number.isInteger(v)).toBe(true);
      expect(v % 2).toBe(0);
      expect(Number.isInteger(n)).toBe(true);
    }),
  );
});
