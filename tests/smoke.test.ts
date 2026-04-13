import { describe, test, expect } from "vitest";
import {
  hegel,
  Hegel,
  integers,
  floats,
  booleans,
  text,
  characters,
  binary,
  just,
  sampledFrom,
  arrays,
  sets,
  maps,
  oneOf,
  optional,
  tuples,
  tuples3,
  composite,
  recordGenerator,
  variantGenerator,
  fromRegex,
  emails,
  dates,
} from "hegel";

describe("basic property tests", () => {
  test(
    "integers within bounds",
    hegel((tc) => {
      const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }),
  );

  test(
    "negative integers",
    hegel((tc) => {
      const x = tc.draw(integers({ minValue: -100, maxValue: -1 }));
      expect(x).toBeLessThan(0);
      expect(x).toBeGreaterThanOrEqual(-100);
    }),
  );

  test(
    "floats within bounds",
    hegel((tc) => {
      const x = tc.draw(
        floats({ minValue: 0, maxValue: 1, allowNan: false, allowInfinity: false }),
      );
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }),
  );

  test(
    "booleans",
    hegel((tc) => {
      const b = tc.draw(booleans());
      expect(typeof b).toBe("boolean");
    }),
  );

  test(
    "text",
    hegel((tc) => {
      const s = tc.draw(text({ minSize: 1, maxSize: 10 }));
      // Server counts codepoints, not UTF-16 code units
      const cpLen = [...s].length;
      expect(cpLen).toBeGreaterThanOrEqual(1);
      expect(cpLen).toBeLessThanOrEqual(10);
    }),
  );

  test(
    "characters",
    hegel((tc) => {
      const c = tc.draw(characters());
      // One codepoint, might be 2 UTF-16 code units for supplementary chars
      expect([...c].length).toBe(1);
    }),
  );

  test(
    "binary",
    hegel((tc) => {
      const b = tc.draw(binary({ minSize: 1, maxSize: 10 }));
      expect(b).toBeInstanceOf(Uint8Array);
      expect(b.length).toBeGreaterThanOrEqual(1);
      expect(b.length).toBeLessThanOrEqual(10);
    }),
  );

  test(
    "just",
    hegel((tc) => {
      const x = tc.draw(just(42));
      expect(x).toBe(42);
    }),
  );

  test(
    "sampledFrom",
    hegel((tc) => {
      const colors = ["red", "green", "blue"];
      const c = tc.draw(sampledFrom(colors));
      expect(colors).toContain(c);
    }),
  );

  test(
    "arrays",
    hegel((tc) => {
      const arr = tc.draw(arrays(integers({ minValue: 0, maxValue: 10 }), { maxSize: 5 }));
      expect(arr.length).toBeLessThanOrEqual(5);
      for (const x of arr) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
      }
    }),
  );

  test(
    "sets",
    hegel((tc) => {
      const s = tc.draw(sets(integers({ minValue: 0, maxValue: 100 }), { maxSize: 5 }));
      expect(s).toBeInstanceOf(Set);
      expect(s.size).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "maps",
    hegel((tc) => {
      const m = tc.draw(
        maps(text({ minSize: 1, maxSize: 5 }), integers({ minValue: 0, maxValue: 100 }), {
          maxSize: 3,
        }),
      );
      expect(m).toBeInstanceOf(Map);
      expect(m.size).toBeLessThanOrEqual(3);
    }),
  );

  test(
    "oneOf",
    hegel((tc) => {
      const x = tc.draw(
        oneOf(integers({ minValue: 0, maxValue: 10 }), integers({ minValue: 100, maxValue: 110 })),
      );
      expect((x >= 0 && x <= 10) || (x >= 100 && x <= 110)).toBe(true);
    }),
  );

  test(
    "optional",
    hegel((tc) => {
      const x = tc.draw(optional(integers({ minValue: 0, maxValue: 10 })));
      if (x !== null) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
      }
    }),
  );

  test(
    "tuples",
    hegel((tc) => {
      const [a, b] = tc.draw(tuples(integers({ minValue: 0, maxValue: 10 }), booleans()));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(10);
      expect(typeof b).toBe("boolean");
    }),
  );

  test(
    "tuples3",
    hegel((tc) => {
      const [a, b, c] = tc.draw(
        tuples3(integers({ minValue: 0, maxValue: 10 }), booleans(), text({ maxSize: 5 })),
      );
      expect(typeof a).toBe("number");
      expect(typeof b).toBe("boolean");
      expect(typeof c).toBe("string");
    }),
  );

  test(
    "composite generator",
    hegel((tc) => {
      const pairGen = composite((inner) => {
        const x = inner.draw(integers({ minValue: 0, maxValue: 100 }));
        const y = inner.draw(integers({ minValue: x, maxValue: 100 }));
        return [x, y] as [number, number];
      });

      const [x, y] = tc.draw(pairGen);
      expect(x).toBeLessThanOrEqual(y);
    }),
  );

  test(
    "recordGenerator",
    hegel((tc) => {
      const userGen = recordGenerator({
        name: text({ minSize: 1, maxSize: 20 }),
        age: integers({ minValue: 0, maxValue: 120 }),
      });

      const user = tc.draw(userGen);
      expect(typeof user.name).toBe("string");
      expect(typeof user.age).toBe("number");
      expect(user.age).toBeGreaterThanOrEqual(0);
    }),
  );

  test(
    "variantGenerator",
    hegel((tc) => {
      type Shape = { type: "circle"; radius: number } | { type: "point" };

      const shapeGen = variantGenerator<Shape>({
        circle: recordGenerator({
          radius: floats({ minValue: 0, maxValue: 100, allowNan: false, allowInfinity: false }),
        }),
        point: null,
      });

      const shape = tc.draw(shapeGen);
      expect(["circle", "point"]).toContain(shape.type);
      if (shape.type === "circle") {
        expect(shape.radius).toBeGreaterThanOrEqual(0);
      }
    }),
  );

  test(
    "map combinator",
    hegel((tc) => {
      const doubleGen = integers({ minValue: 0, maxValue: 50 }).map((x) => x * 2);
      const x = tc.draw(doubleGen);
      expect(x % 2).toBe(0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }),
  );

  test(
    "filter combinator",
    hegel((tc) => {
      const evenGen = integers({ minValue: 0, maxValue: 100 }).filter((x) => x % 2 === 0);
      const x = tc.draw(evenGen);
      expect(x % 2).toBe(0);
    }),
  );

  test(
    "flatMap combinator",
    hegel((tc) => {
      const gen = integers({ minValue: 1, maxValue: 10 }).flatMap((n) =>
        arrays(integers({ minValue: 0, maxValue: 100 }), { minSize: n, maxSize: n }),
      );

      const arr = tc.draw(gen);
      expect(arr.length).toBeGreaterThanOrEqual(1);
      expect(arr.length).toBeLessThanOrEqual(10);
    }),
  );

  test(
    "assume rejects invalid inputs",
    hegel((tc) => {
      const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
      tc.assume(x > 10);
      expect(x).toBeGreaterThan(10);
    }),
  );

  test(
    "note works",
    hegel((tc) => {
      const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
      tc.note(`Generated: ${x}`);
    }),
  );

  test(
    "fromRegex",
    hegel((tc) => {
      const s = tc.draw(fromRegex("[a-z]+", { fullmatch: true }));
      expect(s).toMatch(/^[a-z]+$/);
    }),
  );

  test(
    "emails",
    hegel((tc) => {
      const e = tc.draw(emails());
      expect(e).toContain("@");
    }),
  );

  test(
    "dates",
    hegel((tc) => {
      const d = tc.draw(dates());
      expect(typeof d).toBe("string");
    }),
  );

  test("failing test is detected", () => {
    expect(
      hegel((tc) => {
        const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
        if (x > 0) {
          throw new Error("Found positive number");
        }
      }),
    ).toThrow("Property test failed");
  });

  test("Hegel builder with settings", () => {
    new Hegel((tc) => {
      const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
      expect(x).toBeGreaterThanOrEqual(0);
    })
      .settings({ testCases: 10 })
      .run();
  });
});
