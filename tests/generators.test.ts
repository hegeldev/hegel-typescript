/**
 * Generator tests ported from the old API to the new API.
 *
 * Tests cover:
 * 1. Primitive generators (integers, floats, booleans, text, characters, binary)
 * 2. Constant and selection generators (just, sampledFrom, fromRegex)
 * 3. Format generators (emails, urls, domains, ipAddresses, dates, times, datetimes)
 * 4. hegel.Collection generators (arrays, sets, maps)
 * 5. Combinators (map, filter, flatMap, oneOf, optional, tuples)
 * 6. Composition (composite)
 * 7. Argument validation
 */

import { describe, test, expect, expectTypeOf } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

// ---------------------------------------------------------------------------
// gs.integers()
// ---------------------------------------------------------------------------

describe("gs.integers()", () => {
  test(
    "generates integers in range",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates negative integers",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: -100, maxValue: -1 }));
        expect(v).toBeLessThan(0);
        expect(v).toBeGreaterThanOrEqual(-100);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates without bounds when no args given",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers());
        // Large integers may come back as bigint from CBOR
        expect(typeof v === "number" || typeof v === "bigint").toBe(true);
      },
      { testCases: 10 },
    ),
  );

  test("exposes a schema via asBasic", () => {
    expect(gs.integers().asBasic()).not.toBeNull();
  });

  test("throws if bounds exceed safe integer range", () => {
    expect(() => gs.integers({ minValue: Number.MIN_SAFE_INTEGER - 1 })).toThrow(
      "Use bigIntegers()",
    );
    expect(() => gs.integers({ maxValue: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      "Use bigIntegers()",
    );
  });

  test("exposes a schema with minValue only", () => {
    expect(gs.integers({ minValue: 5 }).asBasic()).not.toBeNull();
  });

  test("exposes a schema with maxValue only", () => {
    expect(gs.integers({ maxValue: 100 }).asBasic()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// gs.bigIntegers()
// ---------------------------------------------------------------------------

describe("gs.bigIntegers()", () => {
  test(
    "generates bigint values",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.bigIntegers());
        expect(typeof v).toBe("bigint");
      },
      { testCases: 20 },
    ),
  );

  test(
    "respects bounds",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.bigIntegers({ minValue: 0n, maxValue: 1000n }));
        expect(v).toBeGreaterThanOrEqual(0n);
        expect(v).toBeLessThanOrEqual(1000n);
      },
      { testCases: 20 },
    ),
  );

  test(
    "can generate values outside safe integer range",
    hegel.test(
      (tc) => {
        const big = BigInt(Number.MAX_SAFE_INTEGER) + 1000n;
        const v = tc.draw(gs.bigIntegers({ minValue: big, maxValue: big + 1000n }));
        expect(v).toBeGreaterThanOrEqual(big);
      },
      { testCases: 10 },
    ),
  );

  test("throws when minValue > maxValue", () => {
    expect(() => gs.bigIntegers({ minValue: 10n, maxValue: 5n })).toThrow(
      "Cannot have maxValue < minValue",
    );
  });
});

// ---------------------------------------------------------------------------
// gs.floats()
// ---------------------------------------------------------------------------

describe("gs.floats()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.floats().asBasic()).not.toBeNull();
  });

  test(
    "generates numbers in range",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.floats({ minValue: 0, maxValue: 1 }));
        expect(typeof v).toBe("number");
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates floats without bounds",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.floats());
        expect(typeof v).toBe("number");
      },
      { testCases: 10 },
    ),
  );

  test(
    "generates floats with only minValue",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.floats({ minValue: 0 }));
        expect(typeof v).toBe("number");
      },
      { testCases: 10 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.booleans()
// ---------------------------------------------------------------------------

describe("gs.booleans()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.booleans().asBasic()).not.toBeNull();
  });

  test(
    "generates booleans",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.booleans());
        expect(typeof v).toBe("boolean");
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.text()
// ---------------------------------------------------------------------------

describe("gs.text()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.text().asBasic()).not.toBeNull();
  });

  test(
    "generates strings within size bounds",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ minSize: 0, maxSize: 20 }));
        expect(typeof v).toBe("string");
        expect([...v].length).toBeLessThanOrEqual(20);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates strings with minSize",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ minSize: 5, maxSize: 20 }));
        expect([...v].length).toBeGreaterThanOrEqual(5);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates strings without maxSize",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text());
        expect(typeof v).toBe("string");
      },
      { testCases: 10 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.characters()
// ---------------------------------------------------------------------------

describe("gs.characters()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.characters().asBasic()).not.toBeNull();
  });

  test(
    "generates single characters",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.characters());
        expect([...v].length).toBe(1);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates characters without options",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.characters());
        expect([...v].length).toBe(1);
        expect(typeof v).toBe("string");
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.binary()
// ---------------------------------------------------------------------------

describe("gs.binary()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.binary().asBasic()).not.toBeNull();
  });

  test(
    "generates Uint8Array within size bounds",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.binary({ minSize: 0, maxSize: 10 }));
        expect(v).toBeInstanceOf(Uint8Array);
        expect(v.length).toBeLessThanOrEqual(10);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates Uint8Array with minSize",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.binary({ minSize: 2, maxSize: 8 }));
        expect(v).toBeInstanceOf(Uint8Array);
        expect(v.length).toBeGreaterThanOrEqual(2);
        expect(v.length).toBeLessThanOrEqual(8);
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.just()
// ---------------------------------------------------------------------------

describe("gs.just()", () => {
  test(
    "returns constant value",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.just(42));
        expect(v).toBe(42);
      },
      { testCases: 10 },
    ),
  );

  test(
    "returns constant object (same reference)",
    hegel.test(
      (tc) => {
        const obj = { x: 1, y: 2 };
        const v = tc.draw(gs.just(obj));
        expect(v).toBe(obj);
      },
      { testCases: 5 },
    ),
  );

  test("returns a Generator", () => {
    const gen = gs.just(42);
    expect(gen).toBeInstanceOf(gs.Generator);
  });
});

// ---------------------------------------------------------------------------
// gs.sampledFrom()
// ---------------------------------------------------------------------------

describe("gs.sampledFrom()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.sampledFrom([1, 2, 3]).asBasic()).not.toBeNull();
  });

  test("throws on empty list", () => {
    expect(() => gs.sampledFrom([])).toThrow("sampledFrom requires at least one element");
  });

  test(
    "returns a value from the list",
    hegel.test(
      (tc) => {
        const items = [10, 20, 30];
        const v = tc.draw(gs.sampledFrom(items));
        expect(items).toContain(v);
      },
      { testCases: 50 },
    ),
  );

  test(
    "returns non-primitive objects from the list",
    hegel.test(
      (tc) => {
        class Custom {
          constructor(public readonly x: number) {}
        }
        const items = [new Custom(1), new Custom(2), new Custom(3)];
        const v = tc.draw(gs.sampledFrom(items));
        expect(v).toBeInstanceOf(Custom);
        expect(items).toContain(v);
      },
      { testCases: 10 },
    ),
  );

  test("covers all values across many runs", () => {
    const items = ["red", "green", "blue"];
    const seen = new Set<string>();
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.sampledFrom(items));
        seen.add(v);
      },
      { testCases: 100 },
    )();
    for (const item of items) {
      expect(seen.has(item)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// gs.fromRegex()
// ---------------------------------------------------------------------------

describe("gs.fromRegex()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.fromRegex("[0-9]+").asBasic()).not.toBeNull();
  });

  test(
    "generates strings matching the pattern",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.fromRegex("[0-9]{3}", { fullmatch: true }));
        expect(v).toMatch(/^[0-9]{3}$/);
      },
      { testCases: 50 },
    ),
  );

  test(
    "fullmatch=false allows partial matches",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.fromRegex("[a-z]+", { fullmatch: false }));
        expect(typeof v).toBe("string");
        expect(v).toMatch(/[a-z]+/);
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.emails()
// ---------------------------------------------------------------------------

describe("gs.emails()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.emails().asBasic()).not.toBeNull();
  });

  test(
    "generates strings containing '@'",
    hegel.test(
      (tc) => {
        const email = tc.draw(gs.emails());
        expect(typeof email).toBe("string");
        expect(email).toContain("@");
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.urls()
// ---------------------------------------------------------------------------

describe("gs.urls()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.urls().asBasic()).not.toBeNull();
  });

  test(
    "generates strings starting with http:// or https://",
    hegel.test(
      (tc) => {
        const url = tc.draw(gs.urls());
        expect(typeof url).toBe("string");
        expect(url.startsWith("http://") || url.startsWith("https://")).toBe(true);
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.domains()
// ---------------------------------------------------------------------------

describe("gs.domains()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.domains().asBasic()).not.toBeNull();
  });

  test(
    "generates valid domain strings",
    hegel.test(
      (tc) => {
        const domain = tc.draw(gs.domains());
        expect(typeof domain).toBe("string");
        expect(domain).toMatch(/^[a-zA-Z0-9.-]+$/);
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.dates()
// ---------------------------------------------------------------------------

describe("gs.dates()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.dates().asBasic()).not.toBeNull();
  });

  test(
    "generates ISO 8601 date strings (YYYY-MM-DD)",
    hegel.test(
      (tc) => {
        const dateStr = tc.draw(gs.dates());
        expect(typeof dateStr).toBe("string");
        expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Must be a valid calendar date
        const parsed = new Date(dateStr + "T00:00:00Z");
        expect(parsed.getTime()).not.toBeNaN();
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.times()
// ---------------------------------------------------------------------------

describe("gs.times()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.times().asBasic()).not.toBeNull();
  });

  test(
    "generates time strings containing ':'",
    hegel.test(
      (tc) => {
        const timeStr = tc.draw(gs.times());
        expect(typeof timeStr).toBe("string");
        expect(timeStr).toContain(":");
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.datetimes()
// ---------------------------------------------------------------------------

describe("gs.datetimes()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.datetimes().asBasic()).not.toBeNull();
  });

  test(
    "generates datetime strings containing 'T'",
    hegel.test(
      (tc) => {
        const dtStr = tc.draw(gs.datetimes());
        expect(typeof dtStr).toBe("string");
        expect(dtStr).toContain("T");
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.arrays()
// ---------------------------------------------------------------------------

describe("gs.arrays()", () => {
  test(
    "all elements in range",
    hegel.test(
      (tc) => {
        const xs = tc.draw(gs.arrays(gs.integers({ minValue: 0, maxValue: 100 })));
        expect(Array.isArray(xs)).toBe(true);
        for (const x of xs) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(100);
        }
      },
      { testCases: 50 },
    ),
  );

  test(
    "respects minSize and maxSize",
    hegel.test(
      (tc) => {
        const xs = tc.draw(gs.arrays(gs.booleans(), { minSize: 3, maxSize: 5 }));
        expect(xs.length).toBeGreaterThanOrEqual(3);
        expect(xs.length).toBeLessThanOrEqual(5);
        for (const x of xs) {
          expect(typeof x).toBe("boolean");
        }
      },
      { testCases: 50 },
    ),
  );

  test(
    "basic element with transform: transform applied per item",
    hegel.test(
      (tc) => {
        const xs = tc.draw(
          gs.arrays(
            gs.integers({ minValue: 0, maxValue: 5 }).map((x) => x * 2),
            { maxSize: 5 },
          ),
        );
        for (const x of xs) {
          expect(x % 2).toBe(0);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(10);
        }
      },
      { testCases: 50 },
    ),
  );

  test(
    "non-basic elements: filtered values",
    hegel.test(
      (tc) => {
        const xs = tc.draw(
          gs.arrays(
            gs.integers({ minValue: 0, maxValue: 10 }).filter((x) => x > 5),
            { minSize: 1, maxSize: 5 },
          ),
        );
        expect(xs.length).toBeGreaterThanOrEqual(1);
        expect(xs.length).toBeLessThanOrEqual(5);
        for (const x of xs) {
          expect(x).toBeGreaterThan(5);
        }
      },
      { testCases: 50 },
    ),
  );

  test(
    "nested arrays",
    hegel.test(
      (tc) => {
        const xss = tc.draw(gs.arrays(gs.arrays(gs.booleans(), { maxSize: 3 }), { maxSize: 3 }));
        expect(Array.isArray(xss)).toBe(true);
        for (const xs of xss) {
          expect(Array.isArray(xs)).toBe(true);
          for (const x of xs) {
            expect(typeof x).toBe("boolean");
          }
        }
      },
      { testCases: 50 },
    ),
  );

  test(
    "unique option",
    hegel.test(
      (tc) => {
        const xs = tc.draw(
          gs.arrays(gs.integers({ minValue: 0, maxValue: 100 }), {
            minSize: 1,
            maxSize: 10,
            unique: true,
          }),
        );
        const set = new Set(xs);
        expect(set.size).toBe(xs.length);
      },
      { testCases: 50 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.sets()
// ---------------------------------------------------------------------------

describe("gs.sets()", () => {
  test(
    "generates Set instances",
    hegel.test(
      (tc) => {
        const s = tc.draw(gs.sets(gs.integers({ minValue: 0, maxValue: 100 }), { maxSize: 5 }));
        expect(s).toBeInstanceOf(Set);
        expect(s.size).toBeLessThanOrEqual(5);
        for (const x of s) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(100);
        }
      },
      { testCases: 30 },
    ),
  );

  test(
    "respects minSize",
    hegel.test(
      (tc) => {
        const s = tc.draw(
          gs.sets(gs.integers({ minValue: 0, maxValue: 1000 }), { minSize: 2, maxSize: 5 }),
        );
        expect(s.size).toBeGreaterThanOrEqual(2);
        expect(s.size).toBeLessThanOrEqual(5);
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.maps()
// ---------------------------------------------------------------------------

describe("gs.maps()", () => {
  test(
    "generates Map instances with basic generators",
    hegel.test(
      (tc) => {
        const m = tc.draw(
          gs.maps(
            gs.text({ minSize: 1, maxSize: 5 }),
            gs.integers({ minValue: 0, maxValue: 100 }),
            {
              maxSize: 3,
            },
          ),
        );
        expect(m).toBeInstanceOf(Map);
        expect(m.size).toBeLessThanOrEqual(3);
        for (const [k, v] of m.entries()) {
          expect(typeof k).toBe("string");
          expect(typeof v).toBe("number");
        }
      },
      { testCases: 30 },
    ),
  );

  test(
    "generates Map with minSize constraint",
    hegel.test(
      (tc) => {
        const m = tc.draw(
          gs.maps(
            gs.text({ minSize: 1, maxSize: 5 }),
            gs.integers({ minValue: 0, maxValue: 100 }),
            {
              minSize: 1,
              maxSize: 5,
            },
          ),
        );
        expect(m.size).toBeGreaterThanOrEqual(1);
      },
      { testCases: 30 },
    ),
  );

  test(
    "applies key and value transforms",
    hegel.test(
      (tc) => {
        const uppercaseKeys = gs.text({ minSize: 1, maxSize: 5 }).map((s) => s.toUpperCase());
        const negatedInts = gs.integers({ minValue: 1, maxValue: 100 }).map((n) => -n);
        const m = tc.draw(gs.maps(uppercaseKeys, negatedInts, { maxSize: 3 }));
        for (const [k, v] of m.entries()) {
          expect(k).toBe(k.toUpperCase());
          expect(v).toBeLessThan(0);
        }
      },
      { testCases: 30 },
    ),
  );

  test(
    "non-basic path (filtered keys) generates Map via collection protocol",
    hegel.test(
      (tc) => {
        const filteredKeys = gs.text({ minSize: 1, maxSize: 3 }).filter((s) => s.length > 0);
        const m = tc.draw(
          gs.maps(filteredKeys, gs.integers({ minValue: 0, maxValue: 100 }), { maxSize: 3 }),
        );
        expect(m).toBeInstanceOf(Map);
        for (const [k, v] of m.entries()) {
          expect(typeof k).toBe("string");
          expect(k.length).toBeGreaterThan(0);
          expect(typeof v).toBe("number");
        }
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// map combinator
// ---------------------------------------------------------------------------

describe("map combinator", () => {
  test("map on a basic source preserves the schema", () => {
    const gen = gs.integers({ minValue: 0, maxValue: 10 }).map((x) => x * 2);
    expect(gen.asBasic()).not.toBeNull();
  });

  test(
    "map transforms values",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: 0, maxValue: 50 }).map((x) => x * 2));
        expect(v % 2).toBe(0);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      },
      { testCases: 20 },
    ),
  );

  test(
    "double map composes transforms",
    hegel.test(
      (tc) => {
        const gen = gs
          .integers({ minValue: 1, maxValue: 5 })
          .map((x) => x * 2)
          .map((x) => x + 1);
        const v = tc.draw(gen);
        // 1..5 => *2 => 2,4,6,8,10 => +1 => 3,5,7,9,11 (always odd)
        expect(v % 2).toBe(1);
        expect(v).toBeGreaterThanOrEqual(3);
        expect(v).toBeLessThanOrEqual(11);
      },
      { testCases: 10 },
    ),
  );

  test(
    "map on non-basic generator (filtered)",
    hegel.test(
      (tc) => {
        const gen = gs.integers({ minValue: 0, maxValue: 10 }).filter((x) => x % 2 === 0);
        const v = tc.draw(gen.map((x) => x * 3));
        expect(v % 6).toBe(0);
      },
      { testCases: 10 },
    ),
  );
});

// ---------------------------------------------------------------------------
// filter combinator
// ---------------------------------------------------------------------------

describe("filter combinator", () => {
  test(
    "filters values correctly",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }).filter((x) => x % 2 === 0));
        expect(v % 2).toBe(0);
      },
      { testCases: 20 },
    ),
  );

  test(
    "filter that always fails causes assumption rejection",
    hegel.test(
      (tc) => {
        // This filter always fails, so all test cases become invalid
        // The test runner treats all-invalid as passing
        tc.draw(gs.integers({ minValue: 0, maxValue: 10 }).filter(() => false));
      },
      { testCases: 5 },
    ),
  );
});

// ---------------------------------------------------------------------------
// flatMap combinator
// ---------------------------------------------------------------------------

describe("flatMap combinator", () => {
  test(
    "generates dependent values",
    hegel.test(
      (tc) => {
        const gen = gs
          .integers({ minValue: 1, maxValue: 10 })
          .flatMap((n) =>
            gs.arrays(gs.integers({ minValue: 0, maxValue: 100 }), { minSize: n, maxSize: n }),
          );
        const arr = tc.draw(gen);
        expect(arr.length).toBeGreaterThanOrEqual(1);
        expect(arr.length).toBeLessThanOrEqual(10);
      },
      { testCases: 20 },
    ),
  );

  test(
    "second value depends on first: gs.text(n,n) length equals n",
    hegel.test(
      (tc) => {
        let capturedN = 0;
        const gen = gs.integers({ minValue: 1, maxValue: 5 }).flatMap((n) => {
          capturedN = n;
          return gs.text({ minSize: n, maxSize: n });
        });
        const s = tc.draw(gen);
        // The text length (in codepoints) must equal the captured integer
        expect([...s].length).toBe(capturedN);
      },
      { testCases: 50 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.oneOf()
// ---------------------------------------------------------------------------

describe("gs.oneOf()", () => {
  test("throws if 0 generators provided", () => {
    expect(() => gs.oneOf()).toThrow("oneOf requires at least one generator");
  });

  test("accepts 1 generator", () => {
    expect(() => gs.oneOf(gs.integers())).not.toThrow();
  });

  test(
    "generates values from one of the branches",
    hegel.test(
      (tc) => {
        const v = tc.draw(
          gs.oneOf(
            gs.integers({ minValue: 0, maxValue: 10 }),
            gs.integers({ minValue: 100, maxValue: 200 }),
          ),
        );
        expect((v >= 0 && v <= 10) || (v >= 100 && v <= 200)).toBe(true);
      },
      { testCases: 50 },
    ),
  );

  test("generates values from both branches across many runs", () => {
    const low: number[] = [];
    const high: number[] = [];
    hegel.test(
      (tc) => {
        const v = tc.draw(
          gs.oneOf(
            gs.integers({ minValue: 0, maxValue: 10 }),
            gs.integers({ minValue: 100, maxValue: 200 }),
          ),
        );
        if (v <= 10) low.push(v);
        else high.push(v);
      },
      { testCases: 100 },
    )();
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
  });

  test(
    "with transforms: dispatches per-branch transform by index",
    hegel.test(
      (tc) => {
        const gen1 = gs.integers({ minValue: 0, maxValue: 5 }).map((x) => x * 2);
        const gen2 = gs.integers({ minValue: 100, maxValue: 105 }).map((x) => x + 1);
        const v = tc.draw(gs.oneOf(gen1, gen2));
        // gen1 produces 0,2,4,6,8,10; gen2 produces 101,102,103,104,105,106
        const isFromGen1 = v >= 0 && v <= 10 && v % 2 === 0;
        const isFromGen2 = v >= 101 && v <= 106;
        expect(isFromGen1 || isFromGen2).toBe(true);
      },
      { testCases: 50 },
    ),
  );

  test(
    "composite path: non-basic generators",
    hegel.test(
      (tc) => {
        const filtered = gs.integers({ minValue: 0, maxValue: 10 }).filter(() => true);
        const v = tc.draw(gs.oneOf(filtered, gs.text({ minSize: 0, maxSize: 5 })));
        expect(typeof v === "number" || typeof v === "string").toBe(true);
      },
      { testCases: 50 },
    ),
  );

  test(
    "composite path generates values from either branch",
    hegel.test(
      (tc) => {
        const filtered = gs.integers({ minValue: 0, maxValue: 100 }).filter(() => true);
        const v = tc.draw(gs.oneOf(filtered, gs.text({ minSize: 0, maxSize: 5 })));
        // Must be a number or string -- validates generator produces valid output
        expect(typeof v === "number" || typeof v === "string").toBe(true);
      },
      { testCases: 50 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.optional()
// ---------------------------------------------------------------------------

describe("gs.optional()", () => {
  test(
    "generates null or a value",
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.optional(gs.integers({ minValue: 0, maxValue: 100 })));
        if (v !== null) {
          expect(typeof v).toBe("number");
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      },
      { testCases: 50 },
    ),
  );

  test("both null and non-null values appear", () => {
    let seenNull = false;
    let seenValue = false;
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.optional(gs.integers({ minValue: 0, maxValue: 10 })));
        if (v === null) seenNull = true;
        else seenValue = true;
      },
      { testCases: 100 },
    )();
    expect(seenNull).toBe(true);
    expect(seenValue).toBe(true);
  });

  test(
    "optional with non-basic inner: generates null or value",
    hegel.test(
      (tc) => {
        const filtered = gs.integers({ minValue: 0, maxValue: 10 }).filter(() => true);
        const v = tc.draw(gs.optional(filtered));
        if (v !== null) {
          expect(typeof v).toBe("number");
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(10);
        }
      },
      { testCases: 50 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.tuples()
// ---------------------------------------------------------------------------

describe("gs.tuples()", () => {
  test(
    "generates 2-tuples with correct types",
    hegel.test(
      (tc) => {
        const [n, b] = tc.draw(
          gs.tuples(gs.integers({ minValue: 0, maxValue: 10 }), gs.booleans()),
        );
        expect(typeof n).toBe("number");
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(10);
        expect(typeof b).toBe("boolean");
      },
      { testCases: 50 },
    ),
  );

  test(
    "all basic with transforms: transforms applied per-position",
    hegel.test(
      (tc) => {
        const g1 = gs.integers({ minValue: 0, maxValue: 10 }).map((x) => x * 2);
        const g2 = gs.integers({ minValue: 0, maxValue: 5 });
        const [a, b] = tc.draw(gs.tuples(g1, g2));
        expect(a % 2).toBe(0);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(20);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(5);
      },
      { testCases: 30 },
    ),
  );

  test(
    "non-basic: filtered elements use composite tuple path",
    hegel.test(
      (tc) => {
        const filtered = gs.integers({ minValue: 0, maxValue: 10 }).filter((x) => x > 5);
        const [n, b] = tc.draw(gs.tuples(filtered, gs.booleans()));
        expect(n).toBeGreaterThan(5);
        expect(n).toBeLessThanOrEqual(10);
        expect(typeof b).toBe("boolean");
      },
      { testCases: 50 },
    ),
  );
});

describe("gs.tuples() 3-tuples", () => {
  test(
    "generates 3-tuples with correct types",
    hegel.test(
      (tc) => {
        const [s, n, f] = tc.draw(
          gs.tuples(
            gs.text({ maxSize: 5 }),
            gs.integers({ minValue: 0, maxValue: 5 }),
            gs.floats({ minValue: 0, maxValue: 1 }),
          ),
        );
        expect(typeof s).toBe("string");
        expect(typeof n).toBe("number");
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(5);
        expect(typeof f).toBe("number");
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      },
      { testCases: 50 },
    ),
  );
});

describe("gs.tuples() 4-tuples", () => {
  test(
    "generates 4-tuples",
    hegel.test(
      (tc) => {
        const [n, b, s, f] = tc.draw(
          gs.tuples(
            gs.integers({ minValue: 0, maxValue: 10 }),
            gs.booleans(),
            gs.text({ maxSize: 5 }),
            gs.floats({ minValue: 0, maxValue: 1 }),
          ),
        );
        expect(typeof n).toBe("number");
        expect(typeof b).toBe("boolean");
        expect(typeof s).toBe("string");
        expect(typeof f).toBe("number");
      },
      { testCases: 30 },
    ),
  );
});

describe("gs.tuples() inferred types", () => {
  test("empty tuple", () => {
    const g = gs.tuples();
    expectTypeOf(g).toEqualTypeOf<gs.Generator<[]>>();
  });

  test("1-tuple", () => {
    const g = gs.tuples(gs.integers());
    expectTypeOf(g).toEqualTypeOf<gs.Generator<[number]>>();
  });

  test("2-tuple with mixed element types", () => {
    const g = gs.tuples(gs.integers(), gs.booleans());
    expectTypeOf(g).toEqualTypeOf<gs.Generator<[number, boolean]>>();
  });

  test("3-tuple preserves per-position types", () => {
    const g = gs.tuples(gs.text(), gs.integers(), gs.floats());
    expectTypeOf(g).toEqualTypeOf<gs.Generator<[string, number, number]>>();
    // Not gs.Generator<(string | number)[]>
    expectTypeOf(g).not.toEqualTypeOf<gs.Generator<(string | number)[]>>();
  });

  test("tuple type survives map()", () => {
    const g = gs.tuples(gs.integers(), gs.booleans()).map(([n, b]) => ({ n, b }));
    expectTypeOf(g).toEqualTypeOf<gs.Generator<{ n: number; b: boolean }>>();
  });

  test("nested tuples infer nested tuple types", () => {
    const g = gs.tuples(gs.tuples(gs.integers(), gs.booleans()), gs.text());
    expectTypeOf(g).toEqualTypeOf<gs.Generator<[[number, boolean], string]>>();
  });

  test("map callback parameter is a tuple, not an array", () => {
    gs.tuples(gs.integers(), gs.booleans()).map((pair) => {
      expectTypeOf(pair).toEqualTypeOf<[number, boolean]>();
      return pair;
    });
  });

  test("high-arity tuple (5 elements)", () => {
    const g = gs.tuples(gs.integers(), gs.booleans(), gs.text(), gs.floats(), gs.integers());
    expectTypeOf(g).toEqualTypeOf<gs.Generator<[number, boolean, string, number, number]>>();
  });
});

// ---------------------------------------------------------------------------
// gs.record()
// ---------------------------------------------------------------------------

describe("gs.record()", () => {
  test(
    "generates plain objects with correct field types",
    hegel.test(
      (tc) => {
        const gen = gs.record({
          name: gs.text({ minSize: 1, maxSize: 10 }),
          age: gs.integers({ minValue: 0, maxValue: 120 }),
          active: gs.booleans(),
        });
        const obj = tc.draw(gen);
        expect(typeof obj.name).toBe("string");
        expect(typeof obj.age).toBe("number");
        expect(typeof obj.active).toBe("boolean");
      },
      { testCases: 20 },
    ),
  );

  test(
    "works with non-basic field generators (composite path)",
    hegel.test(
      (tc) => {
        const gen = gs.record({
          value: gs.integers({ minValue: 0, maxValue: 100 }).filter((x) => x > 10),
        });
        const obj = tc.draw(gen);
        expect(obj.value).toBeGreaterThan(10);
      },
      { testCases: 20 },
    ),
  );

  test(
    "works with gs.just() for constant fields",
    hegel.test(
      (tc) => {
        const gen = gs.record({
          type: gs.just("user" as const),
          id: gs.integers({ minValue: 1, maxValue: 1000 }),
        });
        const obj = tc.draw(gen);
        expect(obj.type).toBe("user");
        expect(obj.id).toBeGreaterThanOrEqual(1);
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// gs.composite()
// ---------------------------------------------------------------------------

describe("gs.composite()", () => {
  test(
    "imperative generator works",
    hegel.test(
      (tc) => {
        const pairGen = gs.composite((inner) => {
          const x = inner.draw(gs.integers({ minValue: 0, maxValue: 100 }));
          const y = inner.draw(gs.integers({ minValue: x, maxValue: 100 }));
          return [x, y] as [number, number];
        });

        const [x, y] = tc.draw(pairGen);
        expect(x).toBeLessThanOrEqual(y);
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

describe("argument validation", () => {
  describe("gs.integers()", () => {
    test("throws when minValue > maxValue", () => {
      expect(() => gs.integers({ minValue: 10, maxValue: 5 })).toThrow();
    });

    test("accepts equal bounds", () => {
      expect(() => gs.integers({ minValue: 5, maxValue: 5 })).not.toThrow();
    });
  });

  describe("gs.arrays()", () => {
    test("throws when minSize > maxSize", () => {
      expect(() => gs.arrays(gs.integers(), { minSize: 5, maxSize: 3 })).toThrow();
    });

    test("accepts equal bounds", () => {
      expect(() => gs.arrays(gs.integers(), { minSize: 3, maxSize: 3 })).not.toThrow();
    });
  });

  describe("gs.oneOf()", () => {
    test("throws when 0 generators provided", () => {
      expect(() => gs.oneOf()).toThrow("oneOf requires at least one generator");
    });

    test("accepts 1 generator", () => {
      expect(() => gs.oneOf(gs.integers())).not.toThrow();
    });

    test("accepts 2 generators", () => {
      expect(() => gs.oneOf(gs.integers(), gs.booleans())).not.toThrow();
    });
  });

  describe("gs.sampledFrom()", () => {
    test("throws on empty array", () => {
      expect(() => gs.sampledFrom([])).toThrow("sampledFrom requires at least one element");
    });
  });
});

describe("generators branch coverage", () => {
  test(
    "binary with minSize exercises minSize branch",
    hegel.test(
      (tc) => {
        const b = tc.draw(gs.binary({ minSize: 5, maxSize: 10 }));
        expect(b.length).toBeGreaterThanOrEqual(5);
      },
      { testCases: 10 },
    ),
  );

  test(
    "sets with minSize exercises minSize branch",
    hegel.test(
      (tc) => {
        const s = tc.draw(
          gs.sets(gs.integers({ minValue: 0, maxValue: 100 }), { minSize: 1, maxSize: 5 }),
        );
        expect(s.size).toBeGreaterThanOrEqual(1);
      },
      { testCases: 10 },
    ),
  );

  test(
    "maps with minSize exercises minSize branch",
    hegel.test(
      (tc) => {
        const m = tc.draw(
          gs.maps(gs.integers({ minValue: 0, maxValue: 100 }), gs.booleans(), {
            minSize: 1,
            maxSize: 3,
          }),
        );
        expect(m.size).toBeGreaterThanOrEqual(1);
      },
      { testCases: 10 },
    ),
  );
});

describe("collection composite path without maxSize", () => {
  test(
    "sets with non-basic elements and no maxSize",
    hegel.test(
      (tc) => {
        const s = tc.draw(gs.sets(gs.integers({ minValue: 0, maxValue: 100 }).filter(() => true)));
        expect(s).toBeInstanceOf(Set);
      },
      { testCases: 10 },
    ),
  );

  test(
    "maps with non-basic elements and no maxSize",
    hegel.test(
      (tc) => {
        const m = tc.draw(
          gs.maps(
            gs.integers({ minValue: 0, maxValue: 100 }).filter(() => true),
            gs.booleans(),
          ),
        );
        expect(m).toBeInstanceOf(Map);
      },
      { testCases: 10 },
    ),
  );
});

describe("gs.ipAddresses()", () => {
  test(
    "gs.ipAddresses({ version: 4 }) generates valid IPv4",
    hegel.test(
      (tc) => {
        const ip = tc.draw(gs.ipAddresses({ version: 4 }));
        expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      },
      { testCases: 10 },
    ),
  );

  test(
    "gs.ipAddresses({ version: 6 }) generates valid IPv6",
    hegel.test(
      (tc) => {
        const ip = tc.draw(gs.ipAddresses({ version: 6 }));
        expect(typeof ip).toBe("string");
        expect(ip).toContain(":");
      },
      { testCases: 10 },
    ),
  );

  test(
    "ipAddresses generates either IPv4 or IPv6",
    hegel.test(
      (tc) => {
        const ip = tc.draw(gs.ipAddresses());
        expect(typeof ip).toBe("string");
      },
      { testCases: 10 },
    ),
  );
});
