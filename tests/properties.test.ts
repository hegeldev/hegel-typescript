/**
 * Property-based tests for JavaScript/TypeScript built-in operations.
 *
 * Inspired by effect-ts's use of fast-check for testing Array, Chunk,
 * BigDecimal, and RuntimeFlags. Ported to use hegel's API instead of
 * fast-check's fc.assert(fc.property(...)) pattern.
 *
 * These tests exercise the hegel library by testing real properties of
 * real code, not just generator smoke tests.
 */

import { describe, test, expect } from "vitest";
import { hegel, integers, floats, text, booleans, arrays, oneOf, composite } from "hegel";

// Default integers() can return BigInt for values outside Number.MAX_SAFE_INTEGER.
// Use bounded integers for tests that need JS number operations.
const ints = () => integers({ minValue: -1_000_000, maxValue: 1_000_000 });

// =========================================================================
// Array properties
// =========================================================================

describe("Array properties", () => {
  test(
    "sort is idempotent",
    hegel((tc) => {
      const arr = tc.draw(arrays(ints()));
      const sorted = [...arr].sort((a, b) => a - b);
      const sortedTwice = [...sorted].sort((a, b) => a - b);
      expect(sorted).toEqual(sortedTwice);
    }),
  );

  test(
    "sort preserves length",
    hegel((tc) => {
      const arr = tc.draw(arrays(ints()));
      expect([...arr].sort((a, b) => a - b).length).toBe(arr.length);
    }),
  );

  test(
    "sort produces ordered output",
    hegel((tc) => {
      const arr = tc.draw(arrays(ints()));
      const sorted = [...arr].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i - 1]);
      }
    }),
  );

  test(
    "sort preserves elements (is a permutation)",
    hegel((tc) => {
      const arr = tc.draw(arrays(integers({ minValue: 0, maxValue: 100 })));
      const sorted = [...arr].sort((a, b) => a - b);
      expect([...sorted].sort()).toEqual([...arr].sort());
    }),
  );

  test(
    "reverse is an involution",
    hegel((tc) => {
      const arr = tc.draw(arrays(ints()));
      expect([...arr].reverse().reverse()).toEqual(arr);
    }),
  );

  test(
    "concat length is sum of lengths",
    hegel((tc) => {
      const a = tc.draw(arrays(ints()));
      const b = tc.draw(arrays(ints()));
      expect(a.concat(b).length).toBe(a.length + b.length);
    }),
  );

  test(
    "concat associativity",
    hegel((tc) => {
      const a = tc.draw(arrays(ints(), { maxSize: 10 }));
      const b = tc.draw(arrays(ints(), { maxSize: 10 }));
      const c = tc.draw(arrays(ints(), { maxSize: 10 }));
      expect(a.concat(b).concat(c)).toEqual(a.concat(b.concat(c)));
    }),
  );

  test(
    "filter preserves order and reduces length",
    hegel((tc) => {
      const arr = tc.draw(arrays(ints()));
      const threshold = tc.draw(ints());
      const filtered = arr.filter((x) => x > threshold);
      expect(filtered.length).toBeLessThanOrEqual(arr.length);
      // Check order is preserved
      for (let i = 1; i < filtered.length; i++) {
        const idxA = arr.indexOf(filtered[i - 1]);
        const idxB = arr.indexOf(filtered[i], idxA + 1);
        expect(idxB).toBeGreaterThan(idxA);
      }
    }),
  );

  test(
    "map preserves length",
    hegel((tc) => {
      const arr = tc.draw(arrays(ints()));
      const mapped = arr.map((x) => x * 2);
      expect(mapped.length).toBe(arr.length);
    }),
  );

  test(
    "flatMap length equals sum of inner lengths",
    hegel((tc) => {
      const arr = tc.draw(arrays(integers({ minValue: 0, maxValue: 5 }), { maxSize: 10 }));
      const result = arr.flatMap((x) => Array.from({ length: x }, (_, i) => i));
      const expectedLength = arr.reduce((sum, x) => sum + x, 0);
      expect(result.length).toBe(expectedLength);
    }),
  );

  test(
    "indexOf finds the element or returns -1",
    hegel((tc) => {
      const arr = tc.draw(arrays(integers({ minValue: 0, maxValue: 20 })));
      const needle = tc.draw(integers({ minValue: 0, maxValue: 20 }));
      const idx = arr.indexOf(needle);
      if (idx >= 0) {
        expect(arr[idx]).toBe(needle);
      } else {
        expect(arr).not.toContain(needle);
      }
    }),
  );

  // Inspired by effect-ts Chunk.test.ts: chunksOf law
  test(
    "chunksOf(n) then flatten equals original (for even-length arrays)",
    hegel((tc) => {
      const arr = tc.draw(arrays(ints(), { maxSize: 20 }));
      const n = tc.draw(integers({ minValue: 1, maxValue: 5 }));

      const chunks: number[][] = [];
      for (let i = 0; i < arr.length; i += n) {
        chunks.push(arr.slice(i, i + n));
      }

      expect(chunks.flat()).toEqual(arr);
    }),
  );
});

// =========================================================================
// Number / Math properties
// =========================================================================

describe("Number properties", () => {
  test(
    "addition is commutative",
    hegel((tc) => {
      const a = tc.draw(ints());
      const b = tc.draw(ints());
      expect(a + b).toBe(b + a);
    }),
  );

  test(
    "addition is associative (for safe integers)",
    hegel((tc) => {
      const a = tc.draw(integers({ minValue: -1000, maxValue: 1000 }));
      const b = tc.draw(integers({ minValue: -1000, maxValue: 1000 }));
      const c = tc.draw(integers({ minValue: -1000, maxValue: 1000 }));
      expect(a + (b + c)).toBe(a + b + c);
    }),
  );

  test(
    "multiplication is commutative",
    hegel((tc) => {
      const a = tc.draw(ints());
      const b = tc.draw(ints());
      expect(a * b).toBe(b * a);
    }),
  );

  test(
    "abs is non-negative",
    hegel((tc) => {
      const n = tc.draw(ints());
      expect(Math.abs(n)).toBeGreaterThanOrEqual(0);
    }),
  );

  test(
    "min/max identity: min(a,b) <= max(a,b)",
    hegel((tc) => {
      const a = tc.draw(ints());
      const b = tc.draw(ints());
      expect(Math.min(a, b)).toBeLessThanOrEqual(Math.max(a, b));
    }),
  );

  test(
    "min/max coverage: {min(a,b), max(a,b)} == {a, b}",
    hegel((tc) => {
      const a = tc.draw(ints());
      const b = tc.draw(ints());
      expect(new Set([Math.min(a, b), Math.max(a, b)])).toEqual(new Set([a, b]));
    }),
  );

  test(
    "finite floats: addition is commutative",
    hegel((tc) => {
      const a = tc.draw(floats({ allowNan: false, allowInfinity: false }));
      const b = tc.draw(floats({ allowNan: false, allowInfinity: false }));
      // Float addition is commutative (unlike some operations)
      expect(a + b).toBe(b + a);
    }),
  );

  test(
    "floor/ceil bracket the value",
    hegel((tc) => {
      const x = tc.draw(
        floats({ minValue: -1e6, maxValue: 1e6, allowNan: false, allowInfinity: false }),
      );
      expect(Math.floor(x)).toBeLessThanOrEqual(x);
      expect(Math.ceil(x)).toBeGreaterThanOrEqual(x);
    }),
  );
});

// =========================================================================
// String properties
// =========================================================================

describe("String properties", () => {
  test(
    "split then join is identity",
    hegel((tc) => {
      const s = tc.draw(text({ maxSize: 50 }));
      // For a separator not in the string, split+join is identity
      const sep = "\x00"; // unlikely to appear in generated text
      expect(s.split(sep).join(sep)).toBe(s);
    }),
  );

  test(
    "repeat length is n * original length",
    hegel((tc) => {
      const s = tc.draw(text({ maxSize: 10 }));
      const n = tc.draw(integers({ minValue: 0, maxValue: 5 }));
      expect(s.repeat(n).length).toBe(s.length * n);
    }),
  );

  test(
    "toUpperCase is idempotent",
    hegel(
      (tc) => {
        const s = tc.draw(text({ maxSize: 20, codec: "ascii" }));
        expect(s.toUpperCase().toUpperCase()).toBe(s.toUpperCase());
      },
      { testCases: 50 },
    ),
  );

  test(
    "trim removes only whitespace",
    hegel(
      (tc) => {
        const s = tc.draw(text({ maxSize: 20, codec: "ascii" }));
        const trimmed = s.trim();
        // trimmed is a substring of s
        expect(s).toContain(trimmed);
        // trimmed has no leading/trailing whitespace
        expect(trimmed).toBe(trimmed.trim());
      },
      { testCases: 50 },
    ),
  );

  test(
    "string concatenation length",
    hegel((tc) => {
      const a = tc.draw(text({ maxSize: 50 }));
      const b = tc.draw(text({ maxSize: 50 }));
      expect((a + b).length).toBe(a.length + b.length);
    }),
  );

  test(
    "includes is consistent with indexOf",
    hegel((tc) => {
      const haystack = tc.draw(text({ maxSize: 20, codec: "ascii" }));
      const needle = tc.draw(text({ maxSize: 5, codec: "ascii" }));
      expect(haystack.includes(needle)).toBe(haystack.indexOf(needle) !== -1);
    }),
  );
});

// =========================================================================
// Set properties
// =========================================================================

describe("Set properties", () => {
  test(
    "union is commutative",
    hegel((tc) => {
      const a = new Set(tc.draw(arrays(integers({ minValue: 0, maxValue: 20 }), { maxSize: 10 })));
      const b = new Set(tc.draw(arrays(integers({ minValue: 0, maxValue: 20 }), { maxSize: 10 })));
      const unionAB = new Set([...a, ...b]);
      const unionBA = new Set([...b, ...a]);
      expect(unionAB).toEqual(unionBA);
    }),
  );

  test(
    "intersection is a subset of both inputs",
    hegel((tc) => {
      const a = new Set(tc.draw(arrays(integers({ minValue: 0, maxValue: 20 }), { maxSize: 10 })));
      const b = new Set(tc.draw(arrays(integers({ minValue: 0, maxValue: 20 }), { maxSize: 10 })));
      const intersection = new Set([...a].filter((x) => b.has(x)));
      for (const x of intersection) {
        expect(a.has(x)).toBe(true);
        expect(b.has(x)).toBe(true);
      }
    }),
  );

  test(
    "|A ∪ B| + |A ∩ B| = |A| + |B|",
    hegel((tc) => {
      const a = new Set(tc.draw(arrays(integers({ minValue: 0, maxValue: 20 }), { maxSize: 10 })));
      const b = new Set(tc.draw(arrays(integers({ minValue: 0, maxValue: 20 }), { maxSize: 10 })));
      const union = new Set([...a, ...b]);
      const intersection = new Set([...a].filter((x) => b.has(x)));
      expect(union.size + intersection.size).toBe(a.size + b.size);
    }),
  );
});

// =========================================================================
// Map properties
// =========================================================================

describe("Map properties", () => {
  test(
    "set then get returns the value",
    hegel((tc) => {
      const key = tc.draw(text({ minSize: 1, maxSize: 10, codec: "ascii" }));
      const value = tc.draw(ints());
      const map = new Map<string, number>();
      map.set(key, value);
      expect(map.get(key)).toBe(value);
    }),
  );

  test(
    "delete removes the key",
    hegel((tc) => {
      const entries = tc.draw(
        arrays(
          composite((inner) => ({
            key: inner.draw(text({ minSize: 1, maxSize: 5, codec: "ascii" })),
            value: inner.draw(ints()),
          })),
          { maxSize: 5 },
        ),
      );
      const map = new Map(entries.map((e) => [e.key, e.value]));
      if (entries.length > 0) {
        const keyToDelete = entries[0].key;
        map.delete(keyToDelete);
        expect(map.has(keyToDelete)).toBe(false);
      }
    }),
  );
});

// =========================================================================
// JSON round-trip properties
// =========================================================================

describe("JSON round-trip properties", () => {
  const jsonValue = oneOf(
    integers({ minValue: -1000, maxValue: 1000 }).map((n) => n as unknown),
    text({ maxSize: 20, codec: "ascii" }).map((s) => s as unknown),
    booleans().map((b) => b as unknown),
  );

  test(
    "JSON.parse(JSON.stringify(x)) preserves value",
    hegel((tc) => {
      const value = tc.draw(jsonValue);
      expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    }),
  );

  test(
    "JSON.stringify produces a string",
    hegel((tc) => {
      const value = tc.draw(jsonValue);
      expect(typeof JSON.stringify(value)).toBe("string");
    }),
  );
});

// =========================================================================
// Bitwise operation properties (inspired by effect-ts RuntimeFlags)
// =========================================================================

describe("Bitwise operation properties", () => {
  const flags = integers({ minValue: 0, maxValue: 0xffff });
  const flag = integers({ minValue: 0, maxValue: 15 }).map((n) => 1 << n);

  test(
    "OR with a flag enables it",
    hegel((tc) => {
      const f = tc.draw(flags);
      const bit = tc.draw(flag);
      expect((f | bit) & bit).toBe(bit);
    }),
  );

  test(
    "AND NOT with a flag disables it",
    hegel((tc) => {
      const f = tc.draw(flags);
      const bit = tc.draw(flag);
      expect(f & ~bit & bit).toBe(0);
    }),
  );

  test(
    "XOR is self-inverse",
    hegel((tc) => {
      const a = tc.draw(flags);
      const b = tc.draw(flags);
      expect(a ^ b ^ b).toBe(a);
    }),
  );

  test(
    "OR is idempotent",
    hegel((tc) => {
      const a = tc.draw(flags);
      expect(a | a).toBe(a);
    }),
  );

  test(
    "AND is idempotent",
    hegel((tc) => {
      const a = tc.draw(flags);
      expect(a & a).toBe(a);
    }),
  );

  test(
    "De Morgan's law: ~(a & b) == ~a | ~b (mod 16 bits)",
    hegel((tc) => {
      const a = tc.draw(flags);
      const b = tc.draw(flags);
      const mask = 0xffff;
      expect(~(a & b) & mask).toBe((~a | ~b) & mask);
    }),
  );

  test(
    "diff and patch: (a ^ (a ^ b)) == b",
    hegel((tc) => {
      const a = tc.draw(flags);
      const b = tc.draw(flags);
      const diff = a ^ b;
      expect(a ^ diff).toBe(b);
    }),
  );
});
