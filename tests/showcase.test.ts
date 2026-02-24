/**
 * Showcase tests demonstrating idiomatic Hegel property-based testing.
 *
 * These tests use the public API (`runHegelTest`, `generateFromSchema`,
 * `assume`) to verify real properties — every generated value is used in
 * a meaningful assertion.
 */

import { describe, it, expect, afterAll } from "vitest";
import { runHegelTest, HegelSession } from "../src/session.js";
import { generateFromSchema } from "../src/client.js";

// ---------------------------------------------------------------------------
// Use a single session for all showcase tests to minimise startup overhead
// ---------------------------------------------------------------------------

const session = new HegelSession();
afterAll(() => session.cleanup());

// ---------------------------------------------------------------------------
// Property: integer addition is commutative  (x + y == y + x)
// ---------------------------------------------------------------------------

describe("showcase: addition is commutative", () => {
  it("x + y === y + x for integers in [-1000, 1000]", async () => {
    await session.runTest(async function additionIsCommutative() {
      const x = (await generateFromSchema({
        type: "integer",
        min_value: -1000,
        max_value: 1000,
      })) as number;
      const y = (await generateFromSchema({
        type: "integer",
        min_value: -1000,
        max_value: 1000,
      })) as number;
      expect(x + y).toBe(y + x);
    }, 200);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Property: double negation is identity  (--x == x)
// ---------------------------------------------------------------------------

describe("showcase: double negation is identity", () => {
  it("-(-x) === x for integers", async () => {
    await session.runTest(async function doubleNegationIsIdentity() {
      const x = (await generateFromSchema({
        type: "integer",
        min_value: -100_000,
        max_value: 100_000,
      })) as number;
      expect(-(-x)).toBe(x);
    }, 200);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Property: abs(x) >= 0 for all integers
// ---------------------------------------------------------------------------

describe("showcase: abs is non-negative", () => {
  it("Math.abs(x) >= 0 for any integer", async () => {
    await session.runTest(async function absIsNonNegative() {
      const x = (await generateFromSchema({
        type: "integer",
        min_value: -1_000_000,
        max_value: 1_000_000,
      })) as number;
      expect(Math.abs(x)).toBeGreaterThanOrEqual(0);
    }, 200);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// End-to-end test against real hegeld: boolean generate and assert
// ---------------------------------------------------------------------------

describe("e2e: boolean generate and assert", () => {
  it("generates a boolean that is true or false", async () => {
    await runHegelTest(
      async function booleanTest() {
        const b = (await generateFromSchema({ type: "boolean" })) as boolean;
        // Every boolean is either true or false — this is a tautology
        expect(b === true || b === false).toBe(true);
      },
      { testCases: 50 },
    );
  }, 60_000);
});
