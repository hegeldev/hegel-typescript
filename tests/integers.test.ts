import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("gs.integers()", () => {
  test("generates integers in range", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      },
      { testCases: 20 },
    ));

  test("generates negative integers", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: -100, maxValue: -1 }));
        expect(v).toBeLessThan(0);
        expect(v).toBeGreaterThanOrEqual(-100);
      },
      { testCases: 20 },
    ));

  test("generates without bounds when no args given", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers());
        // Large integers may come back as bigint from CBOR
        expect(typeof v === "number" || typeof v === "bigint").toBe(true);
      },
      { testCases: 10 },
    ));

  test("exposes a schema via asBasic", () => {
    expect(gs.integers().asBasic()).not.toBeNull();
  });

  test("exposes a schema with minValue only", () => {
    expect(gs.integers({ minValue: 5 }).asBasic()).not.toBeNull();
  });

  test("exposes a schema with maxValue only", () => {
    expect(gs.integers({ maxValue: 100 }).asBasic()).not.toBeNull();
  });

  test("throws if bounds exceed safe integer range", () => {
    expect(() => gs.integers({ minValue: Number.MIN_SAFE_INTEGER - 1 })).toThrow(
      "Use bigIntegers()",
    );
    expect(() => gs.integers({ maxValue: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      "Use bigIntegers()",
    );
  });

  test("throws when minValue > maxValue", () => {
    expect(() => gs.integers({ minValue: 10, maxValue: 5 })).toThrow();
  });

  test("accepts equal bounds", () => {
    expect(() => gs.integers({ minValue: 5, maxValue: 5 })).not.toThrow();
  });
});

describe("gs.bigIntegers()", () => {
  test("generates bigint values", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.bigIntegers());
        expect(typeof v).toBe("bigint");
      },
      { testCases: 20 },
    ));

  test("respects bounds", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.bigIntegers({ minValue: 0n, maxValue: 1000n }));
        expect(v).toBeGreaterThanOrEqual(0n);
        expect(v).toBeLessThanOrEqual(1000n);
      },
      { testCases: 20 },
    ));

  test("can generate values outside safe integer range", () =>
    hegel.test(
      (tc) => {
        const big = BigInt(Number.MAX_SAFE_INTEGER) + 1000n;
        const v = tc.draw(gs.bigIntegers({ minValue: big, maxValue: big + 1000n }));
        expect(v).toBeGreaterThanOrEqual(big);
      },
      { testCases: 10 },
    ));

  test("throws when minValue > maxValue", () => {
    expect(() => gs.bigIntegers({ minValue: 10n, maxValue: 5n })).toThrow(
      "Cannot have maxValue < minValue",
    );
  });
});

describe("gs.bigIntegers() wide ranges", () => {
  test("draws huge negative values via the big-integer path", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.bigIntegers({ minValue: -(2n ** 80n), maxValue: -(2n ** 70n) }));
        expect(v).toBeLessThanOrEqual(-(2n ** 70n));
        expect(v).toBeGreaterThanOrEqual(-(2n ** 80n));
      },
      { testCases: 10 },
    ));

  test("an int64 minimum with a huge maximum uses the big-integer path", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.bigIntegers({ minValue: 0n, maxValue: 2n ** 70n }));
        expect(v).toBeGreaterThanOrEqual(0n);
        expect(v).toBeLessThanOrEqual(2n ** 70n);
      },
      { testCases: 10 },
    ));
});
