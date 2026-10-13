import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("map combinator", () => {
  test("map on a basic source preserves the schema", () => {
    const gen = gs.integers({ minValue: 0, maxValue: 10 }).map((x) => x * 2);
    expect(gen.asBasic()).not.toBeNull();
  });

  test("map transforms values", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: 0, maxValue: 50 }).map((x) => x * 2));
        expect(v % 2).toBe(0);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      },
      { testCases: 20 },
    ));

  test("double map composes transforms", () =>
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
    ));

  test("map on non-basic generator (filtered)", () =>
    hegel.test(
      (tc) => {
        const gen = gs.integers({ minValue: 0, maxValue: 10 }).filter((x) => x % 2 === 0);
        const v = tc.draw(gen.map((x) => x * 3));
        expect(v % 6).toBe(0);
      },
      { testCases: 10 },
    ));
});

describe("filter combinator", () => {
  test("filters values correctly", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }).filter((x) => x % 2 === 0));
        expect(v % 2).toBe(0);
      },
      { testCases: 20 },
    ));

  test("filter that always fails trips the FilterTooMuch health check", () => {
    // Every draw is rejected, so no valid case is ever produced. The engine
    // surfaces this as a FilterTooMuch health-check failure (matching
    // Hypothesis), which the runner reports as a thrown error.
    expect(() =>
      hegel.test((tc) => {
        tc.draw(gs.integers({ minValue: 0, maxValue: 10 }).filter(() => false));
      }),
    ).toThrow(/FilterTooMuch/);
  });

  test("an always-failing filter reports Unsatisfiable even when the health check is suppressed", () => {
    // Suppressing FilterTooMuch no longer hides an always-failing filter: with no
    // valid input ever generated, the run terminates with an Unsatisfiable error
    // instead of the (suppressed) health-check warning.
    expect(() =>
      hegel.test(
        (tc) => {
          tc.draw(gs.integers({ minValue: 0, maxValue: 10 }).filter(() => false));
        },
        { suppressHealthCheck: [hegel.HealthCheck.FilterTooMuch] },
      ),
    ).toThrow(/Unsatisfiable/);
  });
});

describe("flatMap combinator", () => {
  test("generates dependent values", () =>
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
    ));

  test("second value depends on first: gs.text(n,n) length equals n", () =>
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
    ));
});
