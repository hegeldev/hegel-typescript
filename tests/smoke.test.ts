import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("basic property tests", () => {
  test(
    "integers within bounds",
    hegel.test((tc) => {
      const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }),
  );

  test(
    "negative integers",
    hegel.test((tc) => {
      const x = tc.draw(gs.integers({ minValue: -100, maxValue: -1 }));
      expect(x).toBeLessThan(0);
      expect(x).toBeGreaterThanOrEqual(-100);
    }),
  );

  test(
    "floats within bounds",
    hegel.test((tc) => {
      const x = tc.draw(
        gs.floats({ minValue: 0, maxValue: 1, allowNan: false, allowInfinity: false }),
      );
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }),
  );

  test(
    "booleans",
    hegel.test((tc) => {
      const b = tc.draw(gs.booleans());
      expect(typeof b).toBe("boolean");
    }),
  );

  test(
    "text",
    hegel.test((tc) => {
      const s = tc.draw(gs.text({ minSize: 1, maxSize: 10 }));
      // Server counts codepoints, not UTF-16 code units
      const cpLen = [...s].length;
      expect(cpLen).toBeGreaterThanOrEqual(1);
      expect(cpLen).toBeLessThanOrEqual(10);
    }),
  );

  test(
    "characters",
    hegel.test((tc) => {
      const c = tc.draw(gs.characters());
      // One codepoint, might be 2 UTF-16 code units for supplementary chars
      expect([...c].length).toBe(1);
    }),
  );

  test(
    "binary",
    hegel.test((tc) => {
      const b = tc.draw(gs.binary({ minSize: 1, maxSize: 10 }));
      expect(b).toBeInstanceOf(Uint8Array);
      expect(b.length).toBeGreaterThanOrEqual(1);
      expect(b.length).toBeLessThanOrEqual(10);
    }),
  );

  test(
    "just",
    hegel.test((tc) => {
      const x = tc.draw(gs.just(42));
      expect(x).toBe(42);
    }),
  );

  test(
    "sampledFrom",
    hegel.test((tc) => {
      const colors = ["red", "green", "blue"];
      const c = tc.draw(gs.sampledFrom(colors));
      expect(colors).toContain(c);
    }),
  );

  test(
    "arrays",
    hegel.test((tc) => {
      const arr = tc.draw(gs.arrays(gs.integers({ minValue: 0, maxValue: 10 }), { maxSize: 5 }));
      expect(arr.length).toBeLessThanOrEqual(5);
      for (const x of arr) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
      }
    }),
  );

  test(
    "sets",
    hegel.test((tc) => {
      const s = tc.draw(gs.sets(gs.integers({ minValue: 0, maxValue: 100 }), { maxSize: 5 }));
      expect(s).toBeInstanceOf(Set);
      expect(s.size).toBeLessThanOrEqual(5);
    }),
  );

  test(
    "maps",
    hegel.test((tc) => {
      const m = tc.draw(
        gs.maps(gs.text({ minSize: 1, maxSize: 5 }), gs.integers({ minValue: 0, maxValue: 100 }), {
          maxSize: 3,
        }),
      );
      expect(m).toBeInstanceOf(Map);
      expect(m.size).toBeLessThanOrEqual(3);
    }),
  );

  test(
    "oneOf",
    hegel.test((tc) => {
      const x = tc.draw(
        gs.oneOf(
          gs.integers({ minValue: 0, maxValue: 10 }),
          gs.integers({ minValue: 100, maxValue: 110 }),
        ),
      );
      expect((x >= 0 && x <= 10) || (x >= 100 && x <= 110)).toBe(true);
    }),
  );

  test(
    "optional",
    hegel.test((tc) => {
      const x = tc.draw(gs.optional(gs.integers({ minValue: 0, maxValue: 10 })));
      if (x !== null) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(10);
      }
    }),
  );

  test(
    "tuples",
    hegel.test((tc) => {
      const [a, b] = tc.draw(gs.tuples(gs.integers({ minValue: 0, maxValue: 10 }), gs.booleans()));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(10);
      expect(typeof b).toBe("boolean");
    }),
  );

  test(
    "tuples 3-arity",
    hegel.test((tc) => {
      const [a, b, c] = tc.draw(
        gs.tuples(
          gs.integers({ minValue: 0, maxValue: 10 }),
          gs.booleans(),
          gs.text({ maxSize: 5 }),
        ),
      );
      expect(typeof a).toBe("number");
      expect(typeof b).toBe("boolean");
      expect(typeof c).toBe("string");
    }),
  );

  test(
    "composite generator",
    hegel.test((tc) => {
      const pairGen = gs.composite((inner) => {
        const x = inner.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        const y = inner.draw(gs.integers({ minValue: x, maxValue: 100 }));
        return [x, y] as [number, number];
      });

      const [x, y] = tc.draw(pairGen);
      expect(x).toBeLessThanOrEqual(y);
    }),
  );

  test(
    "record generator",
    hegel.test((tc) => {
      const userGen = gs.record({
        name: gs.text({ minSize: 1, maxSize: 20 }),
        age: gs.integers({ minValue: 0, maxValue: 120 }),
      });

      const user = tc.draw(userGen);
      expect(typeof user.name).toBe("string");
      expect(typeof user.age).toBe("number");
      expect(user.age).toBeGreaterThanOrEqual(0);
    }),
  );

  test(
    "oneOf variant",
    hegel.test((tc) => {
      type Shape = { type: "circle"; radius: number } | { type: "point" };

      const shapeGen = gs.oneOf<Shape>(
        gs.record({
          type: gs.just("circle" as const),
          radius: gs.floats({ minValue: 0, maxValue: 100, allowNan: false, allowInfinity: false }),
        }),
        gs.just({ type: "point" as const }),
      );

      const shape = tc.draw(shapeGen);
      expect(["circle", "point"]).toContain(shape.type);
      if (shape.type === "circle") {
        expect(shape.radius).toBeGreaterThanOrEqual(0);
      }
    }),
  );

  test(
    "map combinator",
    hegel.test((tc) => {
      const doubleGen = gs.integers({ minValue: 0, maxValue: 50 }).map((x) => x * 2);
      const x = tc.draw(doubleGen);
      expect(x % 2).toBe(0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }),
  );

  test(
    "filter combinator",
    hegel.test((tc) => {
      const evenGen = gs.integers({ minValue: 0, maxValue: 100 }).filter((x) => x % 2 === 0);
      const x = tc.draw(evenGen);
      expect(x % 2).toBe(0);
    }),
  );

  test(
    "flatMap combinator",
    hegel.test((tc) => {
      const gen = gs
        .integers({ minValue: 1, maxValue: 10 })
        .flatMap((n) =>
          gs.arrays(gs.integers({ minValue: 0, maxValue: 100 }), { minSize: n, maxSize: n }),
        );

      const arr = tc.draw(gen);
      expect(arr.length).toBeGreaterThanOrEqual(1);
      expect(arr.length).toBeLessThanOrEqual(10);
    }),
  );

  test(
    "assume rejects invalid inputs",
    hegel.test((tc) => {
      const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      tc.assume(x > 10);
      expect(x).toBeGreaterThan(10);
    }),
  );

  test(
    "note works",
    hegel.test((tc) => {
      const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      tc.note(`Generated: ${x}`);
    }),
  );

  test(
    "fromRegex",
    hegel.test((tc) => {
      const s = tc.draw(gs.fromRegex("[a-z]+", { fullmatch: true }));
      expect(s).toMatch(/^[a-z]+$/);
    }),
  );

  test(
    "emails",
    hegel.test((tc) => {
      const e = tc.draw(gs.emails());
      expect(e).toContain("@");
    }),
  );

  test(
    "dates",
    hegel.test((tc) => {
      const d = tc.draw(gs.dates());
      expect(typeof d).toBe("string");
    }),
  );

  test("failing test is detected", () => {
    expect(
      hegel.test((tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        if (x > 0) {
          throw new Error("Found positive number");
        }
      }),
    ).toThrow("Property test failed");
  });

  test("Hegel builder with settings", () => {
    new hegel.Hegel((tc) => {
      const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      expect(x).toBeGreaterThanOrEqual(0);
    })
      .settings({ testCases: 10 })
      .run();
  });
});
