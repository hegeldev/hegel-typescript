/**
 * Tests for recordGenerator and variantGenerator derivation.
 *
 * Ported from the old @field/deriveGenerator-based tests. The new API uses
 * recordGenerator({ field: gen }) and variantGenerator({ tag: gen }) exclusively.
 */

import { describe, it, test, expect } from "vitest";
import {
  hegel,
  integers,
  booleans,
  text,
  floats,
  just,
  recordGenerator,
  variantGenerator,
} from "hegel";

// ---------------------------------------------------------------------------
// recordGenerator
// ---------------------------------------------------------------------------

describe("recordGenerator", () => {
  test(
    "generates plain objects with correct fields",
    hegel((tc) => {
      const gen = recordGenerator({
        x: floats({ minValue: -10, maxValue: 10, allowNan: false, allowInfinity: false }),
        y: floats({ minValue: -10, maxValue: 10, allowNan: false, allowInfinity: false }),
      });

      const pt = tc.draw(gen);
      expect(typeof pt.x).toBe("number");
      expect(typeof pt.y).toBe("number");
      expect(pt.x).toBeGreaterThanOrEqual(-10);
      expect(pt.x).toBeLessThanOrEqual(10);
      expect(pt.y).toBeGreaterThanOrEqual(-10);
      expect(pt.y).toBeLessThanOrEqual(10);
    }),
  );

  test(
    "single-field record works",
    hegel((tc) => {
      const gen = recordGenerator({ name: text({ minSize: 1, maxSize: 5 }) });

      const obj = tc.draw(gen);
      expect(typeof obj.name).toBe("string");
      expect([...obj.name].length).toBeGreaterThanOrEqual(1);
    }),
  );

  test(
    "three-field record works",
    hegel((tc) => {
      const gen = recordGenerator({
        id: integers({ minValue: 1, maxValue: 1000 }),
        label: text({ maxSize: 10 }),
        enabled: booleans(),
      });

      const obj = tc.draw(gen);
      expect(typeof obj.id).toBe("number");
      expect(typeof obj.label).toBe("string");
      expect(typeof obj.enabled).toBe("boolean");
    }),
  );

  test(
    "supports map combinator",
    hegel(
      (tc) => {
        const gen = recordGenerator({
          width: floats({
            minValue: 1,
            maxValue: 100,
            allowNan: false,
            allowInfinity: false,
          }),
          height: floats({
            minValue: 1,
            maxValue: 100,
            allowNan: false,
            allowInfinity: false,
          }),
        }).map((r) => r.width * r.height);

        const area = tc.draw(gen);
        expect(typeof area).toBe("number");
        expect(area).toBeGreaterThan(0);
      },
      { testCases: 10 },
    ),
  );
});

// ---------------------------------------------------------------------------
// variantGenerator
// ---------------------------------------------------------------------------

describe("variantGenerator", () => {
  it("throws when given empty variants", () => {
    expect(() => variantGenerator({})).toThrow("variantGenerator requires at least one variant");
  });

  test(
    "generates all data-less variants",
    hegel(
      (tc) => {
        type TrafficLight = { type: "red" } | { type: "yellow" } | { type: "green" };

        const gen = variantGenerator<TrafficLight>({
          red: null,
          yellow: null,
          green: null,
        });

        const v = tc.draw(gen);
        expect(typeof v.type).toBe("string");
        expect(["red", "yellow", "green"]).toContain(v.type);
      },
      { testCases: 100 },
    ),
  );

  test(
    "generates variants with fields",
    hegel(
      (tc) => {
        type Shape =
          | { type: "circle"; radius: number }
          | { type: "rectangle"; width: number; height: number };

        const gen = variantGenerator<Shape>({
          circle: recordGenerator({
            radius: floats({
              minValue: 0.1,
              maxValue: 100,
              allowNan: false,
              allowInfinity: false,
            }),
          }),
          rectangle: recordGenerator({
            width: floats({
              minValue: 0.1,
              maxValue: 100,
              allowNan: false,
              allowInfinity: false,
            }),
            height: floats({
              minValue: 0.1,
              maxValue: 100,
              allowNan: false,
              allowInfinity: false,
            }),
          }),
        });

        const shape = tc.draw(gen);

        if (shape.type === "circle") {
          expect(typeof shape.radius).toBe("number");
          expect(shape.radius).toBeGreaterThanOrEqual(0.1);
        } else {
          expect(shape.type).toBe("rectangle");
          expect(typeof shape.width).toBe("number");
          expect(typeof shape.height).toBe("number");
        }
      },
      { testCases: 100 },
    ),
  );

  test(
    "mixes data-less and data-bearing variants",
    hegel(
      (tc) => {
        type Result = { type: "ok"; value: number } | { type: "error" };

        const gen = variantGenerator<Result>({
          ok: recordGenerator({ value: integers({ minValue: 0, maxValue: 100 }) }),
          error: null,
        });

        const r = tc.draw(gen);

        if (r.type === "ok") {
          expect(typeof r.value).toBe("number");
        } else {
          expect(r.type).toBe("error");
        }
      },
      { testCases: 50 },
    ),
  );

  test(
    "uses custom discriminant property",
    hegel(
      (tc) => {
        type Animal = { kind: "cat" } | { kind: "dog" };

        const gen = variantGenerator<Animal>(
          {
            cat: null,
            dog: null,
          },
          "kind",
        );

        const a = tc.draw(gen);
        expect(["cat", "dog"]).toContain(a.kind);
      },
      { testCases: 20 },
    ),
  );

  test(
    "variant with just() generator",
    hegel(
      (tc) => {
        const gen = variantGenerator({
          a: recordGenerator({ value: just(1) }),
          b: null,
        });

        const v = tc.draw(gen);
        if (v.type === "a") {
          expect(v.value).toBe(1);
        }
      },
      { testCases: 20 },
    ),
  );
});

// ---------------------------------------------------------------------------
// Nested derivation
// ---------------------------------------------------------------------------

describe("nested derivation", () => {
  test(
    "derived record inside derived record",
    hegel(
      (tc) => {
        const addressGen = recordGenerator({
          city: text({ minSize: 1, maxSize: 10 }),
          zip: integers({ minValue: 10000, maxValue: 99999 }),
        });

        const personGen = recordGenerator({
          name: text({ minSize: 1, maxSize: 10 }),
          address: addressGen,
        });

        const person = tc.draw(personGen);
        expect(typeof person.name).toBe("string");
        expect(typeof person.address).toBe("object");
        expect(typeof person.address.city).toBe("string");
        expect(typeof person.address.zip).toBe("number");
        expect(person.address.zip).toBeGreaterThanOrEqual(10000);
        expect(person.address.zip).toBeLessThanOrEqual(99999);
      },
      { testCases: 20 },
    ),
  );
});
