/**
 * Generator tests ported from the old API to the new API.
 *
 * Tests cover:
 * 1. Primitive generators (integers, floats, booleans, text, characters, binary)
 * 2. Constant and selection generators (just, sampledFrom, fromRegex)
 * 3. Format generators (emails, urls, domains, ipAddresses, dates, times, datetimes)
 * 4. Collection generators (arrays/lists, sets, maps/dicts)
 * 5. Combinators (map, filter, flatMap, oneOf, optional, tuples)
 * 6. Composition (composite)
 * 7. Argument validation
 */

import { describe, test, expect } from "vitest";
import {
  hegel,
  integers,
  bigIntegers,
  record,
  floats,
  booleans,
  text,
  characters,
  binary,
  just,
  sampledFrom,
  fromRegex,
  arrays,
  lists,
  sets,
  maps,
  dicts,
  oneOf,
  optional,
  tuples,
  tuples3,
  tuples4,
  emails,
  urls,
  domains,
  ipv4Addresses,
  ipv6Addresses,
  ipAddresses,
  dates,
  times,
  datetimes,
  composite,
  Generator,
  BasicGenerator,
} from "hegel";

// ---------------------------------------------------------------------------
// integers()
// ---------------------------------------------------------------------------

describe("integers()", () => {
  test(
    "generates integers in range",
    hegel(
      (tc) => {
        const v = tc.draw(integers({ minValue: 0, maxValue: 100 }));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates negative integers",
    hegel(
      (tc) => {
        const v = tc.draw(integers({ minValue: -100, maxValue: -1 }));
        expect(v).toBeLessThan(0);
        expect(v).toBeGreaterThanOrEqual(-100);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates without bounds when no args given",
    hegel(
      (tc) => {
        const v = tc.draw(integers());
        // Large integers may come back as bigint from CBOR
        expect(typeof v === "number" || typeof v === "bigint").toBe(true);
      },
      { testCases: 10 },
    ),
  );

  test("returns a BasicGenerator", () => {
    expect(integers()).toBeInstanceOf(BasicGenerator);
  });

  test("throws if bounds exceed safe integer range", () => {
    expect(() => integers({ minValue: Number.MIN_SAFE_INTEGER - 1 })).toThrow("Use bigIntegers()");
    expect(() => integers({ maxValue: Number.MAX_SAFE_INTEGER + 1 })).toThrow("Use bigIntegers()");
  });

  test("returns a BasicGenerator with minValue only", () => {
    const gen = integers({ minValue: 5 });
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  test("returns a BasicGenerator with maxValue only", () => {
    const gen = integers({ maxValue: 100 });
    expect(gen).toBeInstanceOf(BasicGenerator);
  });
});

// ---------------------------------------------------------------------------
// bigIntegers()
// ---------------------------------------------------------------------------

describe("bigIntegers()", () => {
  test(
    "generates bigint values",
    hegel(
      (tc) => {
        const v = tc.draw(bigIntegers());
        expect(typeof v).toBe("bigint");
      },
      { testCases: 20 },
    ),
  );

  test(
    "respects bounds",
    hegel(
      (tc) => {
        const v = tc.draw(bigIntegers({ minValue: 0n, maxValue: 1000n }));
        expect(v).toBeGreaterThanOrEqual(0n);
        expect(v).toBeLessThanOrEqual(1000n);
      },
      { testCases: 20 },
    ),
  );

  test(
    "can generate values outside safe integer range",
    hegel(
      (tc) => {
        const big = BigInt(Number.MAX_SAFE_INTEGER) + 1000n;
        const v = tc.draw(bigIntegers({ minValue: big, maxValue: big + 1000n }));
        expect(v).toBeGreaterThanOrEqual(big);
      },
      { testCases: 10 },
    ),
  );

  test("throws when minValue > maxValue", () => {
    expect(() => bigIntegers({ minValue: 10n, maxValue: 5n })).toThrow(
      "Cannot have maxValue < minValue",
    );
  });
});

// ---------------------------------------------------------------------------
// floats()
// ---------------------------------------------------------------------------

describe("floats()", () => {
  test("returns a BasicGenerator", () => {
    expect(floats()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates numbers in range",
    hegel(
      (tc) => {
        const v = tc.draw(floats({ minValue: 0, maxValue: 1 }));
        expect(typeof v).toBe("number");
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates floats without bounds",
    hegel(
      (tc) => {
        const v = tc.draw(floats());
        expect(typeof v).toBe("number");
      },
      { testCases: 10 },
    ),
  );

  test(
    "generates floats with only minValue",
    hegel(
      (tc) => {
        const v = tc.draw(floats({ minValue: 0 }));
        expect(typeof v).toBe("number");
      },
      { testCases: 10 },
    ),
  );
});

// ---------------------------------------------------------------------------
// booleans()
// ---------------------------------------------------------------------------

describe("booleans()", () => {
  test("returns a BasicGenerator", () => {
    expect(booleans()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates booleans",
    hegel(
      (tc) => {
        const v = tc.draw(booleans());
        expect(typeof v).toBe("boolean");
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// text()
// ---------------------------------------------------------------------------

describe("text()", () => {
  test("returns a BasicGenerator", () => {
    expect(text()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates strings within size bounds",
    hegel(
      (tc) => {
        const v = tc.draw(text({ minSize: 0, maxSize: 20 }));
        expect(typeof v).toBe("string");
        expect([...v].length).toBeLessThanOrEqual(20);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates strings with minSize",
    hegel(
      (tc) => {
        const v = tc.draw(text({ minSize: 5, maxSize: 20 }));
        expect([...v].length).toBeGreaterThanOrEqual(5);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates strings without maxSize",
    hegel(
      (tc) => {
        const v = tc.draw(text());
        expect(typeof v).toBe("string");
      },
      { testCases: 10 },
    ),
  );
});

// ---------------------------------------------------------------------------
// characters()
// ---------------------------------------------------------------------------

describe("characters()", () => {
  test("returns a BasicGenerator", () => {
    expect(characters()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates single characters",
    hegel(
      (tc) => {
        const v = tc.draw(characters());
        expect([...v].length).toBe(1);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates characters without options",
    hegel(
      (tc) => {
        const v = tc.draw(characters());
        expect([...v].length).toBe(1);
        expect(typeof v).toBe("string");
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// binary()
// ---------------------------------------------------------------------------

describe("binary()", () => {
  test("returns a BasicGenerator", () => {
    expect(binary()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates Uint8Array within size bounds",
    hegel(
      (tc) => {
        const v = tc.draw(binary({ minSize: 0, maxSize: 10 }));
        expect(v).toBeInstanceOf(Uint8Array);
        expect(v.length).toBeLessThanOrEqual(10);
      },
      { testCases: 20 },
    ),
  );

  test(
    "generates Uint8Array with minSize",
    hegel(
      (tc) => {
        const v = tc.draw(binary({ minSize: 2, maxSize: 8 }));
        expect(v).toBeInstanceOf(Uint8Array);
        expect(v.length).toBeGreaterThanOrEqual(2);
        expect(v.length).toBeLessThanOrEqual(8);
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// just()
// ---------------------------------------------------------------------------

describe("just()", () => {
  test(
    "returns constant value",
    hegel(
      (tc) => {
        const v = tc.draw(just(42));
        expect(v).toBe(42);
      },
      { testCases: 10 },
    ),
  );

  test(
    "returns constant object (same reference)",
    hegel(
      (tc) => {
        const obj = { x: 1, y: 2 };
        const v = tc.draw(just(obj));
        expect(v).toBe(obj);
      },
      { testCases: 5 },
    ),
  );

  test("returns a Generator", () => {
    const gen = just(42);
    expect(gen).toBeInstanceOf(Generator);
  });
});

// ---------------------------------------------------------------------------
// sampledFrom()
// ---------------------------------------------------------------------------

describe("sampledFrom()", () => {
  test("returns a BasicGenerator", () => {
    expect(sampledFrom([1, 2, 3])).toBeInstanceOf(BasicGenerator);
  });

  test("throws on empty list", () => {
    expect(() => sampledFrom([])).toThrow("sampledFrom requires at least one element");
  });

  test(
    "returns a value from the list",
    hegel(
      (tc) => {
        const items = [10, 20, 30];
        const v = tc.draw(sampledFrom(items));
        expect(items).toContain(v);
      },
      { testCases: 50 },
    ),
  );

  test(
    "returns non-primitive objects from the list",
    hegel(
      (tc) => {
        class Custom {
          constructor(public readonly x: number) {}
        }
        const items = [new Custom(1), new Custom(2), new Custom(3)];
        const v = tc.draw(sampledFrom(items));
        expect(v).toBeInstanceOf(Custom);
        expect(items).toContain(v);
      },
      { testCases: 10 },
    ),
  );

  test("covers all values across many runs", () => {
    const items = ["red", "green", "blue"];
    const seen = new Set<string>();
    hegel(
      (tc) => {
        const v = tc.draw(sampledFrom(items));
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
// fromRegex()
// ---------------------------------------------------------------------------

describe("fromRegex()", () => {
  test("returns a BasicGenerator", () => {
    expect(fromRegex("[0-9]+")).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates strings matching the pattern",
    hegel(
      (tc) => {
        const v = tc.draw(fromRegex("[0-9]{3}", { fullmatch: true }));
        expect(v).toMatch(/^[0-9]{3}$/);
      },
      { testCases: 50 },
    ),
  );

  test(
    "fullmatch=false allows partial matches",
    hegel(
      (tc) => {
        const v = tc.draw(fromRegex("[a-z]+", { fullmatch: false }));
        expect(typeof v).toBe("string");
        expect(v).toMatch(/[a-z]+/);
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// emails()
// ---------------------------------------------------------------------------

describe("emails()", () => {
  test("returns a BasicGenerator", () => {
    expect(emails()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates strings containing '@'",
    hegel(
      (tc) => {
        const email = tc.draw(emails());
        expect(typeof email).toBe("string");
        expect(email).toContain("@");
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// urls()
// ---------------------------------------------------------------------------

describe("urls()", () => {
  test("returns a BasicGenerator", () => {
    expect(urls()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates strings starting with http:// or https://",
    hegel(
      (tc) => {
        const url = tc.draw(urls());
        expect(typeof url).toBe("string");
        expect(url.startsWith("http://") || url.startsWith("https://")).toBe(true);
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// domains()
// ---------------------------------------------------------------------------

describe("domains()", () => {
  test("returns a BasicGenerator", () => {
    expect(domains()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates valid domain strings",
    hegel(
      (tc) => {
        const domain = tc.draw(domains());
        expect(typeof domain).toBe("string");
        expect(domain).toMatch(/^[a-zA-Z0-9.-]+$/);
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// ipAddresses() removed — not supported by current hegel server

// ---------------------------------------------------------------------------
// dates()
// ---------------------------------------------------------------------------

describe("dates()", () => {
  test("returns a BasicGenerator", () => {
    expect(dates()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates ISO 8601 date strings (YYYY-MM-DD)",
    hegel(
      (tc) => {
        const dateStr = tc.draw(dates());
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
// times()
// ---------------------------------------------------------------------------

describe("times()", () => {
  test("returns a BasicGenerator", () => {
    expect(times()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates time strings containing ':'",
    hegel(
      (tc) => {
        const timeStr = tc.draw(times());
        expect(typeof timeStr).toBe("string");
        expect(timeStr).toContain(":");
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// datetimes()
// ---------------------------------------------------------------------------

describe("datetimes()", () => {
  test("returns a BasicGenerator", () => {
    expect(datetimes()).toBeInstanceOf(BasicGenerator);
  });

  test(
    "generates datetime strings containing 'T'",
    hegel(
      (tc) => {
        const dtStr = tc.draw(datetimes());
        expect(typeof dtStr).toBe("string");
        expect(dtStr).toContain("T");
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// arrays() / lists()
// ---------------------------------------------------------------------------

describe("arrays()", () => {
  test(
    "all elements in range",
    hegel(
      (tc) => {
        const xs = tc.draw(arrays(integers({ minValue: 0, maxValue: 100 })));
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
    hegel(
      (tc) => {
        const xs = tc.draw(arrays(booleans(), { minSize: 3, maxSize: 5 }));
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
    hegel(
      (tc) => {
        const xs = tc.draw(
          arrays(
            integers({ minValue: 0, maxValue: 5 }).map((x) => x * 2),
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
    hegel(
      (tc) => {
        const xs = tc.draw(
          arrays(
            integers({ minValue: 0, maxValue: 10 }).filter((x) => x > 5),
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
    hegel(
      (tc) => {
        const xss = tc.draw(arrays(arrays(booleans(), { maxSize: 3 }), { maxSize: 3 }));
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
    hegel(
      (tc) => {
        const xs = tc.draw(
          arrays(integers({ minValue: 0, maxValue: 100 }), {
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

  test("lists is an alias for arrays", () => {
    // Both should be the same function
    expect(lists).toBe(arrays);
  });
});

// ---------------------------------------------------------------------------
// sets()
// ---------------------------------------------------------------------------

describe("sets()", () => {
  test(
    "generates Set instances",
    hegel(
      (tc) => {
        const s = tc.draw(sets(integers({ minValue: 0, maxValue: 100 }), { maxSize: 5 }));
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
    hegel(
      (tc) => {
        const s = tc.draw(
          sets(integers({ minValue: 0, maxValue: 1000 }), { minSize: 2, maxSize: 5 }),
        );
        expect(s.size).toBeGreaterThanOrEqual(2);
        expect(s.size).toBeLessThanOrEqual(5);
      },
      { testCases: 30 },
    ),
  );
});

// ---------------------------------------------------------------------------
// maps() / dicts()
// ---------------------------------------------------------------------------

describe("maps()", () => {
  test(
    "generates Map instances with basic generators",
    hegel(
      (tc) => {
        const m = tc.draw(
          maps(text({ minSize: 1, maxSize: 5 }), integers({ minValue: 0, maxValue: 100 }), {
            maxSize: 3,
          }),
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
    hegel(
      (tc) => {
        const m = tc.draw(
          maps(text({ minSize: 1, maxSize: 5 }), integers({ minValue: 0, maxValue: 100 }), {
            minSize: 1,
            maxSize: 5,
          }),
        );
        expect(m.size).toBeGreaterThanOrEqual(1);
      },
      { testCases: 30 },
    ),
  );

  test(
    "applies key and value transforms",
    hegel(
      (tc) => {
        const uppercaseKeys = text({ minSize: 1, maxSize: 5 }).map((s) => s.toUpperCase());
        const negatedInts = integers({ minValue: 1, maxValue: 100 }).map((n) => -n);
        const m = tc.draw(maps(uppercaseKeys, negatedInts, { maxSize: 3 }));
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
    hegel(
      (tc) => {
        const filteredKeys = text({ minSize: 1, maxSize: 3 }).filter((s) => s.length > 0);
        const m = tc.draw(
          maps(filteredKeys, integers({ minValue: 0, maxValue: 100 }), { maxSize: 3 }),
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

  test("dicts is an alias for maps", () => {
    expect(dicts).toBe(maps);
  });
});

// ---------------------------------------------------------------------------
// map combinator
// ---------------------------------------------------------------------------

describe("map combinator", () => {
  test("BasicGenerator.map() returns a BasicGenerator", () => {
    const gen = integers({ minValue: 0, maxValue: 10 }).map((x) => x * 2);
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  test(
    "map transforms values",
    hegel(
      (tc) => {
        const v = tc.draw(integers({ minValue: 0, maxValue: 50 }).map((x) => x * 2));
        expect(v % 2).toBe(0);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      },
      { testCases: 20 },
    ),
  );

  test(
    "double map composes transforms",
    hegel(
      (tc) => {
        const gen = integers({ minValue: 1, maxValue: 5 })
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
    hegel(
      (tc) => {
        const gen = integers({ minValue: 0, maxValue: 10 }).filter((x) => x % 2 === 0);
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
    hegel(
      (tc) => {
        const v = tc.draw(integers({ minValue: 0, maxValue: 100 }).filter((x) => x % 2 === 0));
        expect(v % 2).toBe(0);
      },
      { testCases: 20 },
    ),
  );

  test(
    "filter that always fails causes assumption rejection",
    hegel(
      (tc) => {
        // This filter always fails, so all test cases become invalid
        // The test runner treats all-invalid as passing
        tc.draw(integers({ minValue: 0, maxValue: 10 }).filter(() => false));
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
    hegel(
      (tc) => {
        const gen = integers({ minValue: 1, maxValue: 10 }).flatMap((n) =>
          arrays(integers({ minValue: 0, maxValue: 100 }), { minSize: n, maxSize: n }),
        );
        const arr = tc.draw(gen);
        expect(arr.length).toBeGreaterThanOrEqual(1);
        expect(arr.length).toBeLessThanOrEqual(10);
      },
      { testCases: 20 },
    ),
  );

  test(
    "second value depends on first: text(n,n) length equals n",
    hegel(
      (tc) => {
        let capturedN = 0;
        const gen = integers({ minValue: 1, maxValue: 5 }).flatMap((n) => {
          capturedN = n;
          return text({ minSize: n, maxSize: n });
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
// oneOf()
// ---------------------------------------------------------------------------

describe("oneOf()", () => {
  test("throws if 0 generators provided", () => {
    expect(() => oneOf()).toThrow("oneOf requires at least one generator");
  });

  test("accepts 1 generator", () => {
    expect(() => oneOf(integers())).not.toThrow();
  });

  test(
    "generates values from one of the branches",
    hegel(
      (tc) => {
        const v = tc.draw(
          oneOf(
            integers({ minValue: 0, maxValue: 10 }),
            integers({ minValue: 100, maxValue: 200 }),
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
    hegel(
      (tc) => {
        const v = tc.draw(
          oneOf(
            integers({ minValue: 0, maxValue: 10 }),
            integers({ minValue: 100, maxValue: 200 }),
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
    "with transforms: dispatches tagged transforms correctly",
    hegel(
      (tc) => {
        const gen1 = integers({ minValue: 0, maxValue: 5 }).map((x) => x * 2);
        const gen2 = integers({ minValue: 100, maxValue: 105 }).map((x) => x + 1);
        const v = tc.draw(oneOf(gen1, gen2));
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
    hegel(
      (tc) => {
        const filtered = integers({ minValue: 0, maxValue: 10 }).filter(() => true);
        const v = tc.draw(oneOf(filtered, text({ minSize: 0, maxSize: 5 })));
        expect(typeof v === "number" || typeof v === "string").toBe(true);
      },
      { testCases: 50 },
    ),
  );

  test(
    "composite path generates values from either branch",
    hegel(
      (tc) => {
        const filtered = integers({ minValue: 0, maxValue: 100 }).filter(() => true);
        const v = tc.draw(oneOf(filtered, text({ minSize: 0, maxSize: 5 })));
        // Must be a number or string -- validates generator produces valid output
        expect(typeof v === "number" || typeof v === "string").toBe(true);
      },
      { testCases: 50 },
    ),
  );
});

// ---------------------------------------------------------------------------
// optional()
// ---------------------------------------------------------------------------

describe("optional()", () => {
  test(
    "generates null or a value",
    hegel(
      (tc) => {
        const v = tc.draw(optional(integers({ minValue: 0, maxValue: 100 })));
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
    hegel(
      (tc) => {
        const v = tc.draw(optional(integers({ minValue: 0, maxValue: 10 })));
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
    hegel(
      (tc) => {
        const filtered = integers({ minValue: 0, maxValue: 10 }).filter(() => true);
        const v = tc.draw(optional(filtered));
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
// tuples() / tuples3() / tuples4()
// ---------------------------------------------------------------------------

describe("tuples()", () => {
  test(
    "generates 2-tuples with correct types",
    hegel(
      (tc) => {
        const [n, b] = tc.draw(tuples(integers({ minValue: 0, maxValue: 10 }), booleans()));
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
    hegel(
      (tc) => {
        const g1 = integers({ minValue: 0, maxValue: 10 }).map((x) => x * 2);
        const g2 = integers({ minValue: 0, maxValue: 5 });
        const [a, b] = tc.draw(tuples(g1, g2));
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
    hegel(
      (tc) => {
        const filtered = integers({ minValue: 0, maxValue: 10 }).filter((x) => x > 5);
        const [n, b] = tc.draw(tuples(filtered, booleans()));
        expect(n).toBeGreaterThan(5);
        expect(n).toBeLessThanOrEqual(10);
        expect(typeof b).toBe("boolean");
      },
      { testCases: 50 },
    ),
  );
});

describe("tuples3()", () => {
  test(
    "generates 3-tuples with correct types",
    hegel(
      (tc) => {
        const [s, n, f] = tc.draw(
          tuples3(
            text({ maxSize: 5 }),
            integers({ minValue: 0, maxValue: 5 }),
            floats({ minValue: 0, maxValue: 1 }),
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

describe("tuples4()", () => {
  test(
    "generates 4-tuples",
    hegel(
      (tc) => {
        const [n, b, s, f] = tc.draw(
          tuples4(
            integers({ minValue: 0, maxValue: 10 }),
            booleans(),
            text({ maxSize: 5 }),
            floats({ minValue: 0, maxValue: 1 }),
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

// ---------------------------------------------------------------------------
// record()
// ---------------------------------------------------------------------------

describe("record()", () => {
  test(
    "generates plain objects with correct field types",
    hegel(
      (tc) => {
        const gen = record({
          name: text({ minSize: 1, maxSize: 10 }),
          age: integers({ minValue: 0, maxValue: 120 }),
          active: booleans(),
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
    hegel(
      (tc) => {
        const gen = record({
          value: integers({ minValue: 0, maxValue: 100 }).filter((x) => x > 10),
        });
        const obj = tc.draw(gen);
        expect(obj.value).toBeGreaterThan(10);
      },
      { testCases: 20 },
    ),
  );

  test(
    "works with just() for constant fields",
    hegel(
      (tc) => {
        const gen = record({
          type: just("user" as const),
          id: integers({ minValue: 1, maxValue: 1000 }),
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
// composite()
// ---------------------------------------------------------------------------

describe("composite()", () => {
  test(
    "imperative generator works",
    hegel(
      (tc) => {
        const pairGen = composite((inner) => {
          const x = inner.draw(integers({ minValue: 0, maxValue: 100 }));
          const y = inner.draw(integers({ minValue: x, maxValue: 100 }));
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
  describe("integers()", () => {
    test("throws when minValue > maxValue", () => {
      expect(() => integers({ minValue: 10, maxValue: 5 })).toThrow();
    });

    test("accepts equal bounds", () => {
      expect(() => integers({ minValue: 5, maxValue: 5 })).not.toThrow();
    });
  });

  describe("arrays()", () => {
    test("throws when minSize > maxSize", () => {
      expect(() => arrays(integers(), { minSize: 5, maxSize: 3 })).toThrow();
    });

    test("accepts equal bounds", () => {
      expect(() => arrays(integers(), { minSize: 3, maxSize: 3 })).not.toThrow();
    });
  });

  describe("oneOf()", () => {
    test("throws when 0 generators provided", () => {
      expect(() => oneOf()).toThrow("oneOf requires at least one generator");
    });

    test("accepts 1 generator", () => {
      expect(() => oneOf(integers())).not.toThrow();
    });

    test("accepts 2 generators", () => {
      expect(() => oneOf(integers(), booleans())).not.toThrow();
    });
  });

  describe("sampledFrom()", () => {
    test("throws on empty array", () => {
      expect(() => sampledFrom([])).toThrow("sampledFrom requires at least one element");
    });
  });
});

describe("generators branch coverage", () => {
  test(
    "binary with minSize exercises minSize branch",
    hegel(
      (tc) => {
        const b = tc.draw(binary({ minSize: 5, maxSize: 10 }));
        expect(b.length).toBeGreaterThanOrEqual(5);
      },
      { testCases: 10 },
    ),
  );

  test(
    "sets with minSize exercises minSize branch",
    hegel(
      (tc) => {
        const s = tc.draw(
          sets(integers({ minValue: 0, maxValue: 100 }), { minSize: 1, maxSize: 5 }),
        );
        expect(s.size).toBeGreaterThanOrEqual(1);
      },
      { testCases: 10 },
    ),
  );

  test(
    "maps with minSize exercises minSize branch",
    hegel(
      (tc) => {
        const m = tc.draw(
          maps(integers({ minValue: 0, maxValue: 100 }), booleans(), { minSize: 1, maxSize: 3 }),
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
    hegel(
      (tc) => {
        const s = tc.draw(sets(integers({ minValue: 0, maxValue: 100 }).filter(() => true)));
        expect(s).toBeInstanceOf(Set);
      },
      { testCases: 10 },
    ),
  );

  test(
    "maps with non-basic elements and no maxSize",
    hegel(
      (tc) => {
        const m = tc.draw(
          maps(
            integers({ minValue: 0, maxValue: 100 }).filter(() => true),
            booleans(),
          ),
        );
        expect(m).toBeInstanceOf(Map);
      },
      { testCases: 10 },
    ),
  );
});

describe("ipAddresses()", () => {
  test(
    "ipv4Addresses generates valid IPv4",
    hegel(
      (tc) => {
        const ip = tc.draw(ipv4Addresses());
        expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      },
      { testCases: 10 },
    ),
  );

  test(
    "ipv6Addresses generates valid IPv6",
    hegel(
      (tc) => {
        const ip = tc.draw(ipv6Addresses());
        expect(typeof ip).toBe("string");
        expect(ip).toContain(":");
      },
      { testCases: 10 },
    ),
  );

  test(
    "ipAddresses generates either IPv4 or IPv6",
    hegel(
      (tc) => {
        const ip = tc.draw(ipAddresses());
        expect(typeof ip).toBe("string");
      },
      { testCases: 10 },
    ),
  );
});
