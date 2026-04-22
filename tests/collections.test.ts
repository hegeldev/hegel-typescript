/**
 * Tests for the collection protocol path (non-basic element generators).
 *
 * When a generator doesn't have asBasic() (e.g. after .filter()), the
 * collection generators (arrays, sets, maps) must use the server's
 * collection protocol (new_collection / collection_more / collection_reject)
 * instead of sending a schema.
 *
 * Ported from hegel-rust tests/test_collections.rs and the old
 * tests/generators/collections.test.ts.
 */

import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

// hegel.Collection protocol tests use fewer test cases because each test case
// involves many server round-trips (one per collection element).
const FEW = { testCases: 20 };

// .filter(() => true) is a no-op filter that strips asBasic(),
// forcing the collection protocol path.
function nonBasic(gen: ReturnType<typeof gs.integers>) {
  return gen.filter(() => true);
}

describe("arrays with non-basic elements (collection protocol)", () => {
  test(
    "generates arrays of filtered integers",
    hegel.test((tc) => {
      const arr = tc.draw(
        gs.arrays(gs.integers({ minValue: 0, maxValue: 100 }).filter((x) => x > 5)),
      );
      for (const x of arr) {
        expect(x).toBeGreaterThan(5);
      }
    }, FEW),
  );

  test(
    "respects maxSize",
    hegel.test((tc) => {
      const arr = tc.draw(
        gs.arrays(nonBasic(gs.integers({ minValue: 0, maxValue: 100 })), { maxSize: 5 }),
      );
      expect(arr.length).toBeLessThanOrEqual(5);
    }, FEW),
  );

  test(
    "respects minSize",
    hegel.test((tc) => {
      const arr = tc.draw(
        gs.arrays(nonBasic(gs.integers({ minValue: 0, maxValue: 100 })), {
          minSize: 1,
          maxSize: 10,
        }),
      );
      expect(arr.length).toBeGreaterThanOrEqual(1);
    }, FEW),
  );

  test(
    "with no max: generates a list",
    hegel.test((tc) => {
      const arr = tc.draw(gs.arrays(nonBasic(gs.integers({ minValue: 0, maxValue: 10 }))));
      expect(Array.isArray(arr)).toBe(true);
      for (const x of arr) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
      }
    }, FEW),
  );

  test(
    "unique arrays with non-basic elements reject duplicates",
    hegel.test((tc) => {
      const arr = tc.draw(
        gs.arrays(nonBasic(gs.integers({ minValue: 0, maxValue: 20 })), {
          maxSize: 5,
          unique: true,
        }),
      );
      const uniqueCount = new Set(arr).size;
      expect(uniqueCount).toBe(arr.length);
    }, FEW),
  );
});

describe("sets with non-basic elements (collection protocol)", () => {
  test(
    "generates sets of filtered integers",
    hegel.test((tc) => {
      const s = tc.draw(
        gs.sets(nonBasic(gs.integers({ minValue: 0, maxValue: 100 })), { maxSize: 5 }),
      );
      expect(s).toBeInstanceOf(Set);
      expect(s.size).toBeLessThanOrEqual(5);
    }, FEW),
  );

  test(
    "respects minSize",
    hegel.test((tc) => {
      const s = tc.draw(
        gs.sets(nonBasic(gs.integers({ minValue: 0, maxValue: 100 })), { minSize: 1, maxSize: 10 }),
      );
      expect(s.size).toBeGreaterThanOrEqual(1);
    }, FEW),
  );
});

describe("maps with non-basic elements (collection protocol)", () => {
  test(
    "generates maps with filtered keys",
    hegel.test((tc) => {
      const m = tc.draw(
        gs.maps(
          gs.integers({ minValue: 0, maxValue: 100 }).filter((x) => x > 5),
          gs.booleans(),
          {
            maxSize: 3,
          },
        ),
      );
      expect(m).toBeInstanceOf(Map);
      expect(m.size).toBeLessThanOrEqual(3);
      for (const key of m.keys()) {
        expect(key).toBeGreaterThan(5);
      }
    }, FEW),
  );

  test(
    "generates maps with filtered values",
    hegel.test((tc) => {
      const m = tc.draw(
        gs.maps(
          gs.text({ minSize: 1, maxSize: 3 }),
          nonBasic(gs.integers({ minValue: 0, maxValue: 100 })),
          {
            maxSize: 3,
          },
        ),
      );
      expect(m).toBeInstanceOf(Map);
    }, FEW),
  );

  test(
    "respects minSize",
    hegel.test((tc) => {
      const m = tc.draw(
        gs.maps(nonBasic(gs.integers({ minValue: 0, maxValue: 100 })), gs.booleans(), {
          minSize: 1,
          maxSize: 5,
        }),
      );
      expect(m.size).toBeGreaterThanOrEqual(1);
    }, FEW),
  );
});
