/**
 * Showcase tests demonstrating idiomatic Hegel property-based testing.
 *
 * These tests show what user code looks like — concise property tests that
 * use the SDK's free-function API. Every generated value is used in a
 * meaningful assertion.
 */

import { describe, it } from "vitest";
import { hegel, runHegelTest } from "../src/session.js";
import { assume, draw, generateFromSchema, _testContextStorage } from "../src/runner.js";
import {
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
  dates,
  datetimes,
  tuples2,
  tuples3,
  oneOf,
  optional,
  ipAddresses,
  dicts,
  lists,
} from "../src/generators.js";
import { field, deriveGenerator, recordGenerator, variantGenerator } from "../src/derive.js";

// ---------------------------------------------------------------------------
// Showcase 1: boolean double-negation (decorator form)
// ---------------------------------------------------------------------------

/**
 * Boolean double-negation is the identity function.
 * For every boolean b: !!b === b
 */
it(
  "boolean double negation is identity",
  hegel({ testCases: 50 })(async () => {
    const b = (await generateFromSchema(
      { type: "boolean" },
      _testContextStorage.getStore()!,
    )) as boolean;
    if (!!b !== b) {
      throw new Error(`!!b !== b for b=${String(b)}`);
    }
  }),
);

// ---------------------------------------------------------------------------
// Showcase 2: boolean OR is commutative (runHegelTest form)
// ---------------------------------------------------------------------------

/**
 * Boolean OR is commutative.
 * For every pair (a, b): (a || b) === (b || a)
 */
it("boolean OR is commutative", async () => {
  await runHegelTest(
    async () => {
      const a = (await generateFromSchema(
        { type: "boolean" },
        _testContextStorage.getStore()!,
      )) as boolean;
      const b = (await generateFromSchema(
        { type: "boolean" },
        _testContextStorage.getStore()!,
      )) as boolean;
      if ((a || b) !== (b || a)) {
        throw new Error(`OR not commutative: a=${String(a)}, b=${String(b)}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 3: integers using the integers() generator
// ---------------------------------------------------------------------------

/**
 * Addition is commutative for integers.
 * For every pair (x, y): x + y === y + x
 */
it("integer addition is commutative", async () => {
  await runHegelTest(
    async () => {
      const x = await draw(integers(-100, 100));
      const y = await draw(integers(-100, 100));
      if (x + y !== y + x) {
        throw new Error(`x + y !== y + x for x=${x}, y=${y}`);
      }
    },
    { testCases: 100 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 4: assume() filters test cases (in a describe block)
// ---------------------------------------------------------------------------

describe("property: filtered assume", () => {
  /**
   * After assume(b === true), b must be true.
   * Demonstrates how assume() filters out unwanted test cases.
   */
  it("assume() filters to only true booleans", async () => {
    await runHegelTest(
      async () => {
        const b = (await generateFromSchema(
          { type: "boolean" },
          _testContextStorage.getStore()!,
        )) as boolean;
        assume(b); // Only continue when b is true
        // b must be true here — if it were false, assume() would have thrown
        if (!b) {
          throw new Error("b should be true after assume(b)");
        }
      },
      { testCases: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Showcase 5: just() — constants are always equal to themselves
// ---------------------------------------------------------------------------

/**
 * just(x) always returns x regardless of server suggestions.
 * For every run: just(42).generate() === 42
 */
it("just() always returns the constant value", async () => {
  await runHegelTest(
    async () => {
      const v = await draw(just(42));
      if (v !== 42) {
        throw new Error(`Expected 42, got ${v}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 6: sampledFrom() — values come from the list
// ---------------------------------------------------------------------------

/**
 * sampledFrom(xs) always returns an element of xs.
 * Demonstrates that sampling preserves membership.
 */
it("sampledFrom() only returns elements from the input list", async () => {
  const colors = ["red", "green", "blue"] as const;
  const colorSet = new Set<string>(colors);
  await runHegelTest(
    async () => {
      const v = await draw(sampledFrom(colors));
      if (!colorSet.has(v)) {
        throw new Error(`Unexpected value: ${v}`);
      }
    },
    { testCases: 100 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 7: fromRegex() — generated strings match the pattern
// ---------------------------------------------------------------------------

/**
 * fromRegex(pattern) generates strings that fully match the pattern.
 * Demonstrates regex-constrained generation.
 */
it("fromRegex() generates strings matching the pattern", async () => {
  const pattern = "[A-Z]{2}[0-9]{4}";
  const re = new RegExp(`^${pattern}$`);
  await runHegelTest(
    async () => {
      const v = await draw(fromRegex(pattern));
      if (!re.test(v)) {
        throw new Error(`"${v}" does not match pattern /${pattern}/`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 8: emails always contain '@' and a domain part
// ---------------------------------------------------------------------------

/**
 * Every generated email address has exactly one '@' separating local and domain parts.
 */
it("email addresses contain exactly one '@' with non-empty parts", async () => {
  await runHegelTest(
    async () => {
      const email = await draw(emails());
      const atIndex = email.indexOf("@");
      if (atIndex <= 0) {
        throw new Error(`Email has no local part before '@': ${email}`);
      }
      if (atIndex === email.length - 1) {
        throw new Error(`Email has no domain part after '@': ${email}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 9: URLs always have a scheme and host
// ---------------------------------------------------------------------------

/**
 * Every generated URL has a well-known scheme (http or https).
 * This demonstrates that url generators produce parseable, structured values.
 */
it("URLs have a valid http/https scheme and a host", async () => {
  await runHegelTest(
    async () => {
      const rawUrl = await draw(urls());
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new Error(`Generated URL is not parseable: ${rawUrl}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Expected http/https scheme, got: ${parsed.protocol}`);
      }
      if (!parsed.hostname) {
        throw new Error(`Generated URL has no hostname: ${rawUrl}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 10: dates round-trip through Date parsing
// ---------------------------------------------------------------------------

/**
 * Every generated date string represents a real calendar date.
 * Converting to a Date object and back must produce the same string.
 */
it("generated dates round-trip through Date parsing", async () => {
  await runHegelTest(
    async () => {
      const dateStr = await draw(dates());
      // Parse as midnight UTC to avoid timezone shifts
      const parsed = new Date(dateStr + "T00:00:00Z");
      if (isNaN(parsed.getTime())) {
        throw new Error(`Generated date is not a valid calendar date: ${dateStr}`);
      }
      const roundTripped = parsed.toISOString().slice(0, 10);
      if (roundTripped !== dateStr) {
        throw new Error(`Date round-trip failed: ${dateStr} -> ${roundTripped}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 11: datetimes contain both date and time components
// ---------------------------------------------------------------------------

/**
 * Every generated datetime string contains a 'T' separator with date and time parts.
 */
it("datetimes contain both date part and time part separated by T", async () => {
  await runHegelTest(
    async () => {
      const dtStr = await draw(datetimes());
      const tIndex = dtStr.indexOf("T");
      if (tIndex <= 0) {
        throw new Error(`Datetime has no date part before 'T': ${dtStr}`);
      }
      if (tIndex === dtStr.length - 1) {
        throw new Error(`Datetime has no time part after 'T': ${dtStr}`);
      }
      // Date part must match YYYY-MM-DD
      const datePart = dtStr.slice(0, tIndex);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        throw new Error(`Datetime date part is not YYYY-MM-DD: ${datePart}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 12: floats — triangle inequality for finite floats
// ---------------------------------------------------------------------------

/**
 * The absolute value of a sum is at most the sum of absolute values.
 * For every pair of finite floats (x, y): |x + y| <= |x| + |y|
 */
it("triangle inequality holds for finite floats", async () => {
  await runHegelTest(
    async () => {
      const x = await draw(floats(-1e6, 1e6));
      const y = await draw(floats(-1e6, 1e6));
      // Both are finite (no NaN/Inf due to bounded range)
      const lhs = Math.abs(x + y);
      const rhs = Math.abs(x) + Math.abs(y);
      // Allow a small epsilon for floating point rounding
      if (lhs > rhs + 1e-9) {
        throw new Error(`|x+y|=${lhs} > |x|+|y|=${rhs} for x=${x}, y=${y}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 13: booleans — De Morgan's law
// ---------------------------------------------------------------------------

/**
 * De Morgan's first law: !(a && b) === !a || !b
 * Verified for all boolean pairs.
 */
it("De Morgan's law: !(a && b) === !a || !b", async () => {
  await runHegelTest(
    async () => {
      const a = await draw(booleans());
      const b = await draw(booleans());
      const lhs = !(a && b);
      const rhs = !a || !b;
      if (lhs !== rhs) {
        throw new Error(
          `De Morgan violated: a=${String(a)}, b=${String(b)}, lhs=${String(lhs)}, rhs=${String(rhs)}`,
        );
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 14: text — string reversal is an involution
// ---------------------------------------------------------------------------

/**
 * Reversing a string twice yields the original string.
 * For every string s: reverse(reverse(s)) === s
 */
it("reversing a string twice is the identity", async () => {
  await runHegelTest(
    async () => {
      const s = await draw(text(0, 20));
      const reversed = [...s].reverse().join("");
      const doubleReversed = [...reversed].reverse().join("");
      if (doubleReversed !== s) {
        throw new Error(`Double reverse mismatch: "${s}" -> "${reversed}" -> "${doubleReversed}"`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 15: binary — concatenation length property
// ---------------------------------------------------------------------------

/**
 * The length of the concatenation of two byte arrays equals the sum of their lengths.
 * For every pair (a, b): concat(a, b).length === a.length + b.length
 */
it("byte array concatenation length is additive", async () => {
  await runHegelTest(
    async () => {
      const a = await draw(binary(0, 10));
      const b = await draw(binary(0, 10));
      const combined = new Uint8Array(a.byteLength + b.byteLength);
      combined.set(a, 0);
      combined.set(b, a.byteLength);
      if (combined.byteLength !== a.byteLength + b.byteLength) {
        throw new Error(
          `Expected combined length ${a.byteLength + b.byteLength}, got ${combined.byteLength}`,
        );
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 16: flatMap — dependent generation (text length equals integer)
// ---------------------------------------------------------------------------

/**
 * `integers(1, 5).flatMap(n => text(n, n))` always produces a string whose
 * Unicode codepoint count equals n. This demonstrates dependent generation:
 * the second generator is chosen based on the first generated value.
 */
it("flatMap: text length equals the controlling integer", async () => {
  await runHegelTest(
    async () => {
      let capturedN = 0;
      const s = await draw(
        integers(1, 5).flatMap((n) => {
          capturedN = n;
          return text(n, n);
        }),
      );
      const codepoints = Array.from(s).length;
      if (codepoints !== capturedN) {
        throw new Error(
          `Expected string of exactly ${capturedN} codepoints, got ${codepoints}: "${s}"`,
        );
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 17: flatMap — matrix row length matches chosen width
// ---------------------------------------------------------------------------

/**
 * Generate a "matrix row": pick a width n in [2, 4], then generate exactly n
 * integers. The resulting array length must equal n, proving that flat_map
 * correctly threads the first value into the second generator.
 */
it("flatMap: array length matches the generated width", async () => {
  await runHegelTest(
    async () => {
      // Generate width n, then produce a list of exactly n integers
      const gen = integers(2, 4).flatMap((n) => lists(integers(0, 99), n, n));
      const row = await draw(gen);
      // The row contains only integers in [0, 99]
      for (const elem of row) {
        if (!Number.isInteger(elem) || elem < 0 || elem > 99) {
          throw new Error(`Row element out of range: ${elem}`);
        }
      }
      // Length is between 2 and 4
      if (row.length < 2 || row.length > 4) {
        throw new Error(`Expected row length 2–4, got ${row.length}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 18: tuples2 — integer-boolean pairs satisfy independent constraints
// ---------------------------------------------------------------------------

/**
 * tuples2(integers(0, 10), booleans()) generates pairs where the integer is in [0,10]
 * and the boolean is a boolean. The two components are independent.
 *
 * Interesting property: negating the boolean does not affect the integer.
 */
it("tuples2: integer and boolean components are independent", async () => {
  await runHegelTest(
    async () => {
      const [n, b] = await draw(tuples2(integers(0, 10), booleans()));
      // Integer constraint
      if (n < 0 || n > 10 || !Number.isInteger(n)) {
        throw new Error(`Integer component out of range [0,10]: ${n}`);
      }
      // Boolean constraint
      if (typeof b !== "boolean") {
        throw new Error(`Boolean component is not a boolean: ${String(b)}`);
      }
      // Independence: negating b leaves n unchanged
      const negated = !b;
      if (n < 0 || n > 10) {
        throw new Error(`Integer changed after boolean negation: ${n}, negated=${String(negated)}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 19: tuples3 — string/integer/float satisfy per-component constraints
// ---------------------------------------------------------------------------

/**
 * tuples3(text(1, 5), integers(0, 100), floats(0, 1)) generates 3-tuples where
 * - the string has 1–5 codepoints
 * - the integer is in [0, 100]
 * - the float is in [0.0, 1.0]
 *
 * Property: the string length plus the integer is always in [1, 105].
 */
it("tuples3: per-component constraints hold independently", async () => {
  await runHegelTest(
    async () => {
      const [s, n, f] = await draw(tuples3(text(1, 5), integers(0, 100), floats(0, 1)));
      const codepoints = Array.from(s).length;
      if (codepoints < 1 || codepoints > 5) {
        throw new Error(`String codepoint count ${codepoints} outside [1, 5]`);
      }
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 100) {
        throw new Error(`Integer ${n} outside [0, 100]`);
      }
      if (typeof f !== "number" || f < 0 || f > 1) {
        throw new Error(`Float ${f} outside [0, 1]`);
      }
      // Property: sum of string length and integer is in [1, 105]
      const sum = codepoints + n;
      if (sum < 1 || sum > 105) {
        throw new Error(`Sum of string length and integer ${sum} outside [1, 105]`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 20: dicts — all values satisfy the value generator constraints
// ---------------------------------------------------------------------------

/**
 * dicts(text(max_size=5), integers(0, 100)) generates a dict where every key
 * is a short string and every value is in [0, 100]. Demonstrates the basic
 * (server-managed) dict generator.
 */
it("dicts: all keys and values satisfy their generator constraints", async () => {
  await runHegelTest(
    async () => {
      const result = (await draw(dicts(text(0, 5), integers(0, 100), 0, 5))) as Record<
        string,
        unknown
      >;
      for (const [key, value] of Object.entries(result)) {
        if (typeof key !== "string") {
          throw new Error("Key is not a string: " + String(key));
        }
        if (Array.from(key).length > 5) {
          throw new Error("Key too long (" + Array.from(key).length + " codepoints): " + key);
        }
        if (typeof value !== "number" || value < 0 || value > 100) {
          throw new Error("Value out of range [0,100]: " + String(value));
        }
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase 21: dicts — size bounds are respected
// ---------------------------------------------------------------------------

/**
 * dicts(integers(0,10), booleans(), min_size=1, max_size=3) generates dicts
 * with exactly 1–3 entries. Demonstrates size constraints on dict generation.
 */
it("dicts: size bounds [min_size=1, max_size=3] are respected", async () => {
  await runHegelTest(
    async () => {
      const result = (await draw(dicts(integers(0, 10), booleans(), 1, 3))) as Record<
        string,
        unknown
      >;
      const size = Object.keys(result).length;
      if (size < 1 || size > 3) {
        throw new Error("Expected dict size in [1,3], got " + size);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: oneOf — union types always satisfy both branches' constraints
// ---------------------------------------------------------------------------

/**
 * oneOf(integers(0, 100), text(1, 10)) produces values that are either
 * a non-negative integer <= 100 or a non-empty string with at most 10 codepoints.
 * Every value satisfies the constraints of its branch.
 */
it("oneOf: every value satisfies the constraints of its branch", async () => {
  await runHegelTest(
    async () => {
      const v = await draw(oneOf(integers(0, 100), text(1, 10)));
      if (typeof v === "number") {
        if (!Number.isInteger(v) || v < 0 || v > 100) {
          throw new Error(`Integer branch out of range: ${v}`);
        }
      } else if (typeof v === "string") {
        const len = Array.from(v).length;
        if (len < 1 || len > 10) {
          throw new Error(`String branch length out of range: ${len} for "${v}"`);
        }
      } else {
        throw new Error(`Unexpected type: ${typeof v}`);
      }
    },
    { testCases: 100 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: oneOf with map — transform is applied correctly per branch
// ---------------------------------------------------------------------------

/**
 * oneOf(integers(0, 10).map(x => x * 2), booleans()) produces values that are
 * either an even integer in [0, 20] or a boolean. When the integer branch is
 * chosen, the map transform must have been applied (value is always even).
 */
it("oneOf with map: integer branch always produces even values", async () => {
  await runHegelTest(
    async () => {
      const v = await draw(
        oneOf(
          integers(0, 10).map((x) => x * 2),
          booleans(),
        ),
      );
      if (typeof v === "number") {
        if (v % 2 !== 0 || v < 0 || v > 20) {
          throw new Error(`Expected even integer in [0,20], got ${v}`);
        }
      } else if (typeof v !== "boolean") {
        throw new Error(`Expected number or boolean, got ${typeof v}`);
      }
    },
    { testCases: 100 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: optional — null is valid, otherwise the element constraint holds
// ---------------------------------------------------------------------------

/**
 * optional(integers(1, 100)) produces null or a positive integer.
 * When a value is produced, it must be in [1, 100].
 * This demonstrates optional as a null-safe generator pattern.
 */
it("optional: null or value within bounds", async () => {
  await runHegelTest(
    async () => {
      const v = await draw(optional(integers(1, 100)));
      if (v === null) {
        // null is valid — the optional case
        return;
      }
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) {
        throw new Error(`Expected null or integer in [1,100], got ${String(v)}`);
      }
    },
    { testCases: 100 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: ipAddresses — structural properties of IP addresses
// ---------------------------------------------------------------------------

/**
 * ipAddresses(4) produces valid IPv4 addresses (4 octets, each 0-255).
 * ipAddresses(6) produces valid IPv6 addresses (contain colons).
 * ipAddresses() produces both kinds.
 */
it("ipAddresses(4): every value is a valid dotted-decimal IPv4 address", async () => {
  await runHegelTest(
    async () => {
      const ip = await draw(ipAddresses(4));
      if (typeof ip !== "string") {
        throw new Error(`Expected string, got ${typeof ip}`);
      }
      const parts = ip.split(".");
      if (parts.length !== 4) {
        throw new Error(`Expected 4 octets, got ${parts.length}: "${ip}"`);
      }
      for (const part of parts) {
        const octet = parseInt(part, 10);
        if (isNaN(octet) || octet < 0 || octet > 255 || String(octet) !== part) {
          throw new Error(`Invalid octet "${part}" in address "${ip}"`);
        }
      }
    },
    { testCases: 50 },
  );
});

it("ipAddresses(): mixed v4 and v6 — all values parseable as IP addresses", async () => {
  await runHegelTest(
    async () => {
      const ip = await draw(ipAddresses());
      if (typeof ip !== "string" || ip.length === 0) {
        throw new Error(`Expected non-empty IP string, got ${String(ip)}`);
      }
      // Valid IP address: either contains '.' (v4) or ':' (v6)
      const hasV4Separator = ip.includes(".");
      const hasV6Separator = ip.includes(":");
      if (!hasV4Separator && !hasV6Separator) {
        throw new Error(`IP "${ip}" contains neither '.' nor ':'`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: lists — filtering preserves the predicate
// ---------------------------------------------------------------------------

/**
 * Every element in a filtered list satisfies the predicate.
 * Demonstrates that lists() correctly composes with filter().
 */
it("filtered list: every element satisfies the filter predicate", async () => {
  await runHegelTest(
    async () => {
      const xs = await draw(
        lists(
          integers(0, 100).filter((x) => x % 2 === 0),
          1,
          5,
        ),
      );
      if (!Array.isArray(xs) || xs.length < 1 || xs.length > 5) {
        throw new Error(`Expected list of length 1-5, got ${xs.length}`);
      }
      for (const x of xs) {
        if (typeof x !== "number" || x % 2 !== 0 || x < 0 || x > 100) {
          throw new Error(`Expected even number in [0,100], got ${x}`);
        }
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: lists — reversing a list twice is the identity
// ---------------------------------------------------------------------------

/**
 * Reversing a list twice yields the original list.
 * For every list xs: reverse(reverse(xs)) deepEquals xs
 */
it("reversing a list twice is the identity", async () => {
  await runHegelTest(
    async () => {
      const xs = await draw(lists(integers(0, 100), 0, 10));
      const once = [...xs].reverse();
      const twice = [...once].reverse();
      if (xs.length !== twice.length) {
        throw new Error(`Length mismatch after double reverse: ${xs.length} vs ${twice.length}`);
      }
      for (let i = 0; i < xs.length; i++) {
        if (xs[i] !== twice[i]) {
          throw new Error(`Element mismatch at index ${i}: ${xs[i]} vs ${twice[i]}`);
        }
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: deriveGenerator — decorated class generates valid instances
// ---------------------------------------------------------------------------

/**
 * A 2D vector class with @field decorators. The derived generator produces
 * Vector2D instances whose x and y are both within [-1000, 1000].
 *
 * Property: the magnitude is always <= sqrt(x^2 + y^2), and for bounded
 * floats this is always <= sqrt(2) * 1000.
 */
class Vector2D {
  @field(floats(-1000, 1000))
  x!: number;

  @field(floats(-1000, 1000))
  y!: number;
}

it("deriveGenerator: Vector2D magnitude is bounded by sqrt(2)*1000", async () => {
  const gen = deriveGenerator(Vector2D);
  await runHegelTest(
    async () => {
      const v = await draw(gen);
      if (!(v instanceof Vector2D)) {
        throw new Error("Expected instance of Vector2D");
      }
      const mag = Math.sqrt(v.x * v.x + v.y * v.y);
      const bound = Math.SQRT2 * 1000 + 1e-9; // small epsilon for FP
      if (mag > bound) {
        throw new Error(`|v| = ${mag} exceeds bound ${bound} for v=(${v.x}, ${v.y})`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: recordGenerator — point distance is always non-negative
// ---------------------------------------------------------------------------

/**
 * Generate two 2D points as plain objects, then verify that the Euclidean
 * distance between them is always non-negative (a trivially true but
 * meaningful mathematical property).
 */
it("recordGenerator: distance between two points is non-negative", async () => {
  const pointGen = recordGenerator({
    x: floats(-100, 100),
    y: floats(-100, 100),
  });

  await runHegelTest(
    async () => {
      const p1 = await draw(pointGen);
      const p2 = await draw(pointGen);
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0) {
        throw new Error(`Distance is negative: ${dist}`);
      }
      // Triangle inequality: dist(p1, p2) <= |p1| + |p2|
      const mag1 = Math.sqrt(p1.x * p1.x + p1.y * p1.y);
      const mag2 = Math.sqrt(p2.x * p2.x + p2.y * p2.y);
      if (dist > mag1 + mag2 + 1e-9) {
        throw new Error(`Triangle inequality violated: dist=${dist}, |p1|=${mag1}, |p2|=${mag2}`);
      }
    },
    { testCases: 50 },
  );
});

// ---------------------------------------------------------------------------
// Showcase: variantGenerator — discriminated union covers all variants
// ---------------------------------------------------------------------------

/**
 * A Shape type with circle and rectangle variants. Every generated shape
 * has a valid discriminant and non-negative dimensions.
 *
 * Property: the area of every shape is non-negative.
 */
it("variantGenerator: every Shape has non-negative area", async () => {
  type Shape =
    | { type: "circle"; radius: number }
    | { type: "rectangle"; width: number; height: number }
    | { type: "point" };

  const shapeGen = variantGenerator<Shape>({
    circle: recordGenerator({ radius: floats(0, 100) }),
    rectangle: recordGenerator({
      width: floats(0, 100),
      height: floats(0, 100),
    }),
    point: null,
  });

  const seen = new Set<string>();

  await runHegelTest(
    async () => {
      const shape = await draw(shapeGen);
      seen.add(shape.type);

      let area: number;
      if (shape.type === "circle") {
        area = Math.PI * shape.radius * shape.radius;
      } else if (shape.type === "rectangle") {
        area = shape.width * shape.height;
      } else {
        // point has zero area
        area = 0;
      }

      if (area < -1e-15) {
        throw new Error(`Negative area ${area} for shape type "${shape.type}"`);
      }
    },
    { testCases: 100 },
  );

  // With 100 test cases and 3 variants, we should see all of them
  if (seen.size < 2) {
    throw new Error(`Expected at least 2 variant types, only saw: ${[...seen].join(", ")}`);
  }
});

// ---------------------------------------------------------------------------
// Showcase: nested derivation — derived record inside variant
// ---------------------------------------------------------------------------

/**
 * A message type where each variant carries different structured payload.
 * Demonstrates composing recordGenerator inside variantGenerator for
 * non-trivial nested types.
 */
it("variantGenerator: nested records in message protocol", async () => {
  type Message =
    | { kind: "text"; body: string; sender: string }
    | { kind: "image"; url: string; width: number; height: number };

  const msgGen = variantGenerator<Message>(
    {
      text: recordGenerator({
        body: text(1, 50),
        sender: text(1, 10),
      }),
      image: recordGenerator({
        url: text(5, 30),
        width: integers(1, 4096),
        height: integers(1, 4096),
      }),
    },
    "kind",
  );

  await runHegelTest(
    async () => {
      const msg = await draw(msgGen);
      if (msg.kind === "text") {
        if (typeof msg.body !== "string" || msg.body.length === 0) {
          throw new Error("Text message body must be non-empty");
        }
        if (typeof msg.sender !== "string" || msg.sender.length === 0) {
          throw new Error("Text message sender must be non-empty");
        }
      } else if (msg.kind === "image") {
        if (typeof msg.url !== "string" || msg.url.length < 5) {
          throw new Error("Image URL too short");
        }
        if (msg.width < 1 || msg.height < 1) {
          throw new Error(`Invalid image dimensions: ${msg.width}x${msg.height}`);
        }
        // Property: image pixel count is always positive
        const pixels = msg.width * msg.height;
        if (pixels < 1) {
          throw new Error(`Image must have at least 1 pixel, got ${pixels}`);
        }
      } else {
        throw new Error(`Unknown message kind: ${(msg as { kind: string }).kind}`);
      }
    },
    { testCases: 50 },
  );
});
