/**
 * Regression tests: uniqueness and minimum-size contracts of arrays, sets,
 * and maps must hold on FINAL (post-.map()) values.
 *
 * Historically a mapped generator kept its source's schema and applied the
 * map in parse, so the engine enforced `unique` / `min_size` on the raw
 * pre-map values. A non-injective map could then produce duplicate elements
 * in a unique array, or collapse enough raws that a Set/Map came out smaller
 * than minSize.
 */

import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

// x % 2 collapses 0..100 onto {0, 1}: distinct raws, frequently equal values.
const parity = () => gs.integers({ minValue: 0, maxValue: 100 }).map((x) => x % 2);

describe("unique arrays with mapped elements", () => {
  test("uniqueness holds on post-map values", () =>
    hegel.test(
      (tc) => {
        const xs = tc.draw(gs.arrays(parity(), { unique: true, maxSize: 10 }));
        expect(new Set(xs).size).toBe(xs.length);
      },
      { testCases: 50 },
    ));
});

describe("sets with mapped elements", () => {
  test("minSize holds on post-map values", () =>
    hegel.test(
      (tc) => {
        const s = tc.draw(gs.sets(parity(), { minSize: 2, maxSize: 5 }));
        expect(s.size).toBeGreaterThanOrEqual(2);
        expect(s.size).toBeLessThanOrEqual(5);
      },
      { testCases: 30 },
    ));
});

describe("maps with mapped keys", () => {
  test("minSize holds on post-map keys", () =>
    hegel.test(
      (tc) => {
        const m = tc.draw(gs.maps(parity(), gs.booleans(), { minSize: 2, maxSize: 5 }));
        expect(m.size).toBeGreaterThanOrEqual(2);
        expect(m.size).toBeLessThanOrEqual(5);
      },
      { testCases: 30 },
    ));

  test("maps with mapped values keep the schema path and apply the transform", () =>
    // Only keys need deduplication; a mapped VALUE generator must not force
    // the collection protocol path.
    hegel.test(
      (tc) => {
        const m = tc.draw(
          gs.maps(
            gs.integers({ minValue: 0, maxValue: 100 }),
            gs.integers({ minValue: 1, maxValue: 100 }).map((n) => -n),
            { minSize: 1, maxSize: 5 },
          ),
        );
        expect(m.size).toBeGreaterThanOrEqual(1);
        for (const v of m.values()) {
          expect(v).toBeLessThan(0);
        }
      },
      { testCases: 30 },
    ));
});

describe("composite generators propagate non-injective parses", () => {
  test("sets of tuples containing mapped elements meet minSize on final values", () =>
    hegel.test(
      (tc) => {
        const s = tc.draw(
          gs.sets(gs.tuples(gs.integers({ minValue: 0, maxValue: 1 }), parity()), {
            minSize: 3,
            maxSize: 4,
          }),
        );
        expect(s.size).toBeGreaterThanOrEqual(3);
        const xs = [...s];
        for (let i = 0; i < xs.length; i++) {
          for (let j = i + 1; j < xs.length; j++) {
            expect(xs[i]).not.toEqual(xs[j]);
          }
        }
      },
      { testCases: 20 },
    ));

  test("sets of records containing mapped fields deduplicate final values", () =>
    hegel.test(
      (tc) => {
        const s = tc.draw(gs.sets(gs.record({ p: parity() }), { maxSize: 5 }));
        const xs = [...s];
        for (let i = 0; i < xs.length; i++) {
          for (let j = i + 1; j < xs.length; j++) {
            expect(xs[i]).not.toEqual(xs[j]);
          }
        }
      },
      { testCases: 30 },
    ));

  test("unique arrays of oneOf involving mapped branches deduplicate final values", () =>
    hegel.test(
      (tc) => {
        const xs = tc.draw(
          gs.arrays(gs.oneOf(parity(), gs.integers({ minValue: 0, maxValue: 1 })), {
            unique: true,
            maxSize: 6,
          }),
        );
        expect(new Set(xs).size).toBe(xs.length);
      },
      { testCases: 50 },
    ));

  test("sets of optional mapped elements meet minSize on final values", () =>
    hegel.test(
      (tc) => {
        const s = tc.draw(gs.sets(gs.optional(parity()), { minSize: 2, maxSize: 5 }));
        // Only three distinct values exist (null, 0, 1), and minSize counts
        // distinct final values.
        expect(s.size).toBeGreaterThanOrEqual(2);
        expect(s.size).toBeLessThanOrEqual(3);
      },
      { testCases: 50 },
    ));

  test("sets of arrays of mapped elements deduplicate final values", () =>
    hegel.test(
      (tc) => {
        const s = tc.draw(gs.sets(gs.arrays(parity(), { maxSize: 2 }), { maxSize: 5 }));
        const xs = [...s];
        for (let i = 0; i < xs.length; i++) {
          for (let j = i + 1; j < xs.length; j++) {
            expect(xs[i]).not.toEqual(xs[j]);
          }
        }
      },
      { testCases: 30 },
    ));
});
