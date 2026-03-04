/**
 * Tests for the type-directed generator derivation module.
 *
 * Covers the @field decorator, deriveGenerator, recordGenerator,
 * variantGenerator, and all their edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  runHegelTest,
  draw,
  integers,
  booleans,
  text,
  floats,
  just,
  field,
  deriveGenerator,
  DerivedGenerator,
  recordGenerator,
  RecordDerivedGenerator,
  variantGenerator,
  VariantGenerator,
} from "hegel";
import { _classFieldMeta, _resetFieldOrder } from "../src/derive.js";

// ---------------------------------------------------------------------------
// @field decorator — metadata registration
// ---------------------------------------------------------------------------

describe("@field decorator", () => {
  it("registers field metadata on the class constructor", () => {
    class TestClass {
      @field(integers(0, 10))
      x!: number;
    }

    const meta = _classFieldMeta.get(TestClass);
    expect(meta).toBeDefined();
    expect(meta!.length).toBe(1);
    expect(meta![0]!.name).toBe("x");
  });

  it("registers multiple fields in order", () => {
    class MultiField {
      @field(integers(0, 10))
      a!: number;

      @field(booleans())
      b!: boolean;

      @field(text(0, 5))
      c!: string;
    }

    const meta = _classFieldMeta.get(MultiField);
    expect(meta).toBeDefined();
    expect(meta!.length).toBe(3);
    // Fields should be in order of application
    expect(meta![0]!.name).toBe("a");
    expect(meta![1]!.name).toBe("b");
    expect(meta![2]!.name).toBe("c");
  });

  it("appends to existing metadata on the same class", () => {
    class AppendClass {
      @field(integers())
      first!: number;

      @field(integers())
      second!: number;
    }

    const meta = _classFieldMeta.get(AppendClass);
    expect(meta).toBeDefined();
    expect(meta!.length).toBe(2);
    expect(meta![0]!.name).toBe("first");
    expect(meta![1]!.name).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// _resetFieldOrder
// ---------------------------------------------------------------------------

describe("_resetFieldOrder", () => {
  it("resets the global field order counter", () => {
    _resetFieldOrder();
    // After reset, next field registered should have order starting from 0
    class ResetTest {
      @field(integers())
      val!: number;
    }
    const meta = _classFieldMeta.get(ResetTest);
    expect(meta).toBeDefined();
    expect(meta![0]!.order).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveGenerator
// ---------------------------------------------------------------------------

describe("deriveGenerator", () => {
  it("throws when class has no @field annotations", () => {
    class Plain {
      x!: number;
    }
    expect(() => deriveGenerator(Plain)).toThrow("No @field annotations found on Plain");
  });

  it("returns a DerivedGenerator with correct fields", () => {
    class WithFields {
      @field(integers(0, 10))
      x!: number;

      @field(booleans())
      y!: boolean;
    }

    const gen = deriveGenerator(WithFields);
    expect(gen).toBeInstanceOf(DerivedGenerator);
    expect(gen._ctor).toBe(WithFields);
    expect(gen._fields.length).toBe(2);
  });

  it("generates instances of the class via live server", async () => {
    class Point {
      @field(integers(-100, 100))
      x!: number;

      @field(integers(-100, 100))
      y!: number;
    }

    const gen = deriveGenerator(Point);

    await runHegelTest(
      async () => {
        const pt = await draw(gen);
        expect(pt).toBeInstanceOf(Point);
        expect(typeof pt.x).toBe("number");
        expect(typeof pt.y).toBe("number");
        expect(pt.x).toBeGreaterThanOrEqual(-100);
        expect(pt.x).toBeLessThanOrEqual(100);
        expect(pt.y).toBeGreaterThanOrEqual(-100);
        expect(pt.y).toBeLessThanOrEqual(100);
      },
      { testCases: 20 },
    );
  });

  it("generates class with 3 fields (string, int, boolean)", async () => {
    class User {
      @field(text(1, 10))
      name!: string;

      @field(integers(18, 120))
      age!: number;

      @field(booleans())
      active!: boolean;
    }

    const gen = deriveGenerator(User);

    await runHegelTest(
      async () => {
        const user = await draw(gen);
        expect(user).toBeInstanceOf(User);
        expect(typeof user.name).toBe("string");
        expect(Array.from(user.name).length).toBeGreaterThanOrEqual(1);
        expect(Array.from(user.name).length).toBeLessThanOrEqual(10);
        expect(typeof user.age).toBe("number");
        expect(user.age).toBeGreaterThanOrEqual(18);
        expect(user.age).toBeLessThanOrEqual(120);
        expect(typeof user.active).toBe("boolean");
      },
      { testCases: 20 },
    );
  });

  it("single-field class works", async () => {
    class Wrapper {
      @field(integers(0, 999))
      value!: number;
    }

    const gen = deriveGenerator(Wrapper);

    await runHegelTest(
      async () => {
        const w = await draw(gen);
        expect(w).toBeInstanceOf(Wrapper);
        expect(w.value).toBeGreaterThanOrEqual(0);
        expect(w.value).toBeLessThanOrEqual(999);
      },
      { testCases: 10 },
    );
  });

  it("works with map/filter/flatMap combinators", async () => {
    class Pair {
      @field(integers(1, 10))
      a!: number;

      @field(integers(1, 10))
      b!: number;
    }

    const gen = deriveGenerator(Pair).map((p) => p.a + p.b);

    await runHegelTest(
      async () => {
        const sum = await draw(gen);
        expect(typeof sum).toBe("number");
        expect(sum).toBeGreaterThanOrEqual(2);
        expect(sum).toBeLessThanOrEqual(20);
      },
      { testCases: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// recordGenerator
// ---------------------------------------------------------------------------

describe("recordGenerator", () => {
  it("throws when schema has no fields", () => {
    expect(() => recordGenerator({})).toThrow("recordGenerator requires at least one field.");
  });

  it("returns a RecordDerivedGenerator", () => {
    const gen = recordGenerator({ x: integers() });
    expect(gen).toBeInstanceOf(RecordDerivedGenerator);
  });

  it("generates plain objects with correct fields", async () => {
    const gen = recordGenerator({
      x: floats(-10, 10),
      y: floats(-10, 10),
    });

    await runHegelTest(
      async () => {
        const pt = await draw(gen);
        expect(typeof pt.x).toBe("number");
        expect(typeof pt.y).toBe("number");
        expect(pt.x).toBeGreaterThanOrEqual(-10);
        expect(pt.x).toBeLessThanOrEqual(10);
        expect(pt.y).toBeGreaterThanOrEqual(-10);
        expect(pt.y).toBeLessThanOrEqual(10);
      },
      { testCases: 20 },
    );
  });

  it("single-field record works", async () => {
    const gen = recordGenerator({ name: text(1, 5) });

    await runHegelTest(
      async () => {
        const obj = await draw(gen);
        expect(typeof obj.name).toBe("string");
        expect(Array.from(obj.name).length).toBeGreaterThanOrEqual(1);
      },
      { testCases: 10 },
    );
  });

  it("three-field record works", async () => {
    const gen = recordGenerator({
      id: integers(1, 1000),
      label: text(0, 10),
      enabled: booleans(),
    });

    await runHegelTest(
      async () => {
        const obj = await draw(gen);
        expect(typeof obj.id).toBe("number");
        expect(typeof obj.label).toBe("string");
        expect(typeof obj.enabled).toBe("boolean");
      },
      { testCases: 20 },
    );
  });

  it("supports map combinator", async () => {
    const gen = recordGenerator({
      width: floats(1, 100),
      height: floats(1, 100),
    }).map((r) => r.width * r.height);

    await runHegelTest(
      async () => {
        const area = await draw(gen);
        expect(typeof area).toBe("number");
        expect(area).toBeGreaterThan(0);
      },
      { testCases: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// variantGenerator
// ---------------------------------------------------------------------------

describe("variantGenerator", () => {
  it("throws when fewer than 2 variants", () => {
    expect(() => variantGenerator({ only: null })).toThrow(
      "variantGenerator requires at least 2 variants.",
    );
  });

  it("throws with empty variants", () => {
    expect(() => variantGenerator({})).toThrow("variantGenerator requires at least 2 variants.");
  });

  it("returns a VariantGenerator", () => {
    const gen = variantGenerator({
      a: null,
      b: null,
    });
    expect(gen).toBeInstanceOf(VariantGenerator);
  });

  it("generates all variants (data-less) via live server", async () => {
    type TrafficLight = { type: "red" } | { type: "yellow" } | { type: "green" };

    const gen = variantGenerator<TrafficLight>({
      red: null,
      yellow: null,
      green: null,
    });

    const seen = new Set<string>();

    await runHegelTest(
      async () => {
        const v = await draw(gen);
        expect(typeof v.type).toBe("string");
        expect(["red", "yellow", "green"]).toContain(v.type);
        seen.add(v.type);
      },
      { testCases: 100 },
    );

    // With 100 test cases, we should see all 3 variants
    expect(seen.size).toBe(3);
  });

  it("generates variants with fields via live server", async () => {
    type Shape =
      | { type: "circle"; radius: number }
      | { type: "rectangle"; width: number; height: number };

    const gen = variantGenerator<Shape>({
      circle: recordGenerator({ radius: floats(0.1, 100) }),
      rectangle: recordGenerator({
        width: floats(0.1, 100),
        height: floats(0.1, 100),
      }),
    });

    const seen = new Set<string>();

    await runHegelTest(
      async () => {
        const shape = await draw(gen);
        seen.add(shape.type);

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
    );

    expect(seen.size).toBe(2);
  });

  it("mixes data-less and data-bearing variants", async () => {
    type Result = { type: "ok"; value: number } | { type: "error" };

    const gen = variantGenerator<Result>({
      ok: recordGenerator({ value: integers(0, 100) }),
      error: null,
    });

    const seen = new Set<string>();

    await runHegelTest(
      async () => {
        const r = await draw(gen);
        seen.add(r.type);

        if (r.type === "ok") {
          expect(typeof r.value).toBe("number");
        }
      },
      { testCases: 50 },
    );

    expect(seen.size).toBe(2);
  });

  it("uses custom discriminant property", async () => {
    type Animal = { kind: "cat" } | { kind: "dog" };

    const gen = variantGenerator<Animal>(
      {
        cat: null,
        dog: null,
      },
      "kind",
    );

    await runHegelTest(
      async () => {
        const a = await draw(gen);
        expect(["cat", "dog"]).toContain(a.kind);
      },
      { testCases: 20 },
    );
  });

  it("internal state: _variants and _discriminant are correct", () => {
    const gen = variantGenerator({
      a: just(1),
      b: null,
    });
    expect(gen._variants.length).toBe(2);
    expect(gen._variants[0]!.tag).toBe("a");
    expect(gen._variants[0]!.fields).not.toBeNull();
    expect(gen._variants[1]!.tag).toBe("b");
    expect(gen._variants[1]!.fields).toBeNull();
    expect(gen._discriminant).toBe("type");
  });
});

// ---------------------------------------------------------------------------
// DerivedGenerator — field ordering
// ---------------------------------------------------------------------------

describe("DerivedGenerator field ordering", () => {
  it("sorts fields by order", () => {
    class Ordered {
      @field(integers())
      z!: number;

      @field(integers())
      a!: number;
    }

    const gen = deriveGenerator(Ordered);
    // z was decorated first, a second — sorted by order
    expect(gen._fields[0]!.name).toBe("z");
    expect(gen._fields[1]!.name).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Nested derivation — derived types as fields of other derived types
// ---------------------------------------------------------------------------

describe("nested derivation", () => {
  it("derived record inside derived record", async () => {
    const addressGen = recordGenerator({
      city: text(1, 10),
      zip: integers(10000, 99999),
    });

    const personGen = recordGenerator({
      name: text(1, 10),
      address: addressGen,
    });

    await runHegelTest(
      async () => {
        const person = await draw(personGen);
        expect(typeof person.name).toBe("string");
        expect(typeof person.address).toBe("object");
        expect(typeof person.address.city).toBe("string");
        expect(typeof person.address.zip).toBe("number");
        expect(person.address.zip).toBeGreaterThanOrEqual(10000);
        expect(person.address.zip).toBeLessThanOrEqual(99999);
      },
      { testCases: 20 },
    );
  });
});
