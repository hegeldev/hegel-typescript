/**
 * Regression tests for the uniqueness semantics of the collection protocol
 * (non-basic) paths of arrays, sets, and maps.
 *
 * Historically each path used a different notion of equality:
 * - arrays compared `JSON.stringify` output, which equates NaN with null
 *   (both stringify to "null") and all functions/undefined with each other,
 * - sets and maps used reference equality, which treats structurally equal
 *   objects as distinct.
 *
 * All three now share one structural value-equality helper (`valuesEqual`).
 */

import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("unique arrays (collection protocol) use structural equality", () => {
  test("NaN and null are distinct elements", () =>
    // JSON.stringify renders both NaN and null as "null", so the old
    // stringify-based check treated them as duplicates and could never
    // build a unique 2-element array from [NaN, null].
    hegel.test(
      (tc) => {
        const elements = gs.sampledFrom([NaN, null]).filter(() => true);
        const xs = tc.draw(gs.arrays(elements, { unique: true, minSize: 2, maxSize: 2 }));
        expect(xs).toHaveLength(2);
        const nans = xs.filter((x) => typeof x === "number" && Number.isNaN(x));
        const nulls = xs.filter((x) => x === null);
        expect(nans).toHaveLength(1);
        expect(nulls).toHaveLength(1);
      },
      { testCases: 10 },
    ));

  test("distinct functions are distinct elements", () =>
    // JSON.stringify(fn) is undefined for every function, so the old check
    // treated all functions as duplicates of each other.
    hegel.test(
      (tc) => {
        const f = (x: number) => x + 1;
        const g = (x: number) => x + 2;
        const elements = gs.sampledFrom([f, g]).filter(() => true);
        const xs = tc.draw(gs.arrays(elements, { unique: true, minSize: 2, maxSize: 2 }));
        expect(xs).toHaveLength(2);
        expect(new Set(xs).size).toBe(2);
      },
      { testCases: 10 },
    ));

  test("structurally equal objects are duplicates", () =>
    hegel.test(
      (tc) => {
        const elements = gs
          .record({ v: gs.integers({ minValue: 0, maxValue: 1 }) })
          .filter(() => true);
        const xs = tc.draw(gs.arrays(elements, { unique: true, maxSize: 6 }));
        for (let i = 0; i < xs.length; i++) {
          for (let j = i + 1; j < xs.length; j++) {
            expect(xs[i]).not.toEqual(xs[j]);
          }
        }
      },
      { testCases: 30 },
    ));
});

describe("sets (collection protocol) use structural equality", () => {
  test("structurally equal objects are duplicates", () =>
    // The old check used `Set.has`, i.e. reference equality, so a Set could
    // contain many structurally identical objects. With only two possible
    // element values, any set of size >= 3 must contain structural dupes.
    hegel.test(
      (tc) => {
        const elements = gs
          .record({ v: gs.integers({ minValue: 0, maxValue: 1 }) })
          .filter(() => true);
        const s = tc.draw(gs.sets(elements, { maxSize: 6 }));
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

describe("maps (collection protocol) use structural equality for keys", () => {
  test("structurally equal keys are duplicates", () =>
    hegel.test(
      (tc) => {
        const keys = gs.record({ v: gs.integers({ minValue: 0, maxValue: 1 }) }).filter(() => true);
        const m = tc.draw(gs.maps(keys, gs.booleans(), { maxSize: 6 }));
        const ks = [...m.keys()];
        for (let i = 0; i < ks.length; i++) {
          for (let j = i + 1; j < ks.length; j++) {
            expect(ks[i]).not.toEqual(ks[j]);
          }
        }
      },
      { testCases: 30 },
    ));
});
