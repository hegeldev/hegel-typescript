import { describe, expect, it } from "vitest";
import {
  BasicGenerator,
  integers,
  booleans,
  text,
  floats,
  just,
  tuples2,
  tuples3,
  tuples4,
  oneOf,
  optional,
  ipAddresses,
  draw,
  runHegelTest,
} from "hegel";
import { CompositeTupleGenerator, CompositeOneOfGenerator } from "../../src/generators/index.js";

// ---------------------------------------------------------------------------
// tuples2 / tuples3 / tuples4
// ---------------------------------------------------------------------------

describe("tuples2()", () => {
  // --- Schema structure tests (all basic, no transforms) ---

  it("all basic, no transforms: returns BasicGenerator with tuple schema", () => {
    const gen = tuples2(integers(), booleans());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<[number, boolean]>).schema();
    expect(schema["type"]).toBe("tuple");
    expect(Array.isArray(schema["elements"])).toBe(true);
    const elems = schema["elements"] as Record<string, unknown>[];
    expect(elems).toHaveLength(2);
    expect(elems[0]).toMatchObject({ type: "integer" });
    expect(elems[1]).toMatchObject({ type: "boolean" });
  });

  it("all basic, no transforms: _transform is null (no transform applied)", () => {
    const gen = tuples2(integers(), booleans()) as BasicGenerator<[number, boolean]>;
    expect(gen._transform).toBeNull();
  });

  it("all basic WITH transforms: schema still uses raw element schemas", () => {
    const g1 = integers(0, 10).map((x) => x * 2);
    const g2 = just(5).map((x) => x + 1);
    expect(g1).toBeInstanceOf(BasicGenerator);
    expect(g2).toBeInstanceOf(BasicGenerator);
    expect(g1._transform).not.toBeNull();
    expect(g2._transform).not.toBeNull();

    const gen = tuples2(g1, g2) as BasicGenerator<[number, number]>;
    expect(gen).toBeInstanceOf(BasicGenerator);

    const schema = gen.schema();
    expect(schema["type"]).toBe("tuple");
    const elems = schema["elements"] as Record<string, unknown>[];
    // Raw schemas — NOT the transformed schemas
    expect(elems[0]).toMatchObject({ type: "integer", min_value: 0, max_value: 10 });
    expect(elems[1]).toMatchObject({ const: null });
    // A combined transform must exist
    expect(gen._transform).not.toBeNull();
  });

  it("all basic WITH transforms: transform applies per-position via live server", async () => {
    await runHegelTest(
      async () => {
        const g1 = integers(0, 10).map((x) => x * 2);
        const g2 = just(5).map((x) => x + 1);
        const gen = tuples2(g1, g2);
        const v = await draw(gen);
        const [a, b] = v;
        // a is integers(0,10) * 2 → even, in [0, 20]
        if (a % 2 !== 0 || a < 0 || a > 20) {
          throw new Error(`Expected even in [0,20], got ${a}`);
        }
        // b is just(5) + 1 → always 6
        if (b !== 6) {
          throw new Error(`Expected 6, got ${b}`);
        }
      },
      { testCases: 30 },
    );
  });

  // --- Mixed basic/non-basic ---

  it("mixed basic/non-basic: returns CompositeTupleGenerator", () => {
    const filtered = integers(0, 10).filter(() => true);
    const gen = tuples2(filtered, booleans());
    expect(gen).toBeInstanceOf(CompositeTupleGenerator);
    expect(gen).not.toBeInstanceOf(BasicGenerator);
  });

  it("non-basic: generates 2-tuples via live server (TUPLE span used)", async () => {
    await runHegelTest(
      async () => {
        const filtered = integers(0, 10).filter(() => true);
        const gen = tuples2(filtered, booleans());
        const v = await draw(gen);
        if (!Array.isArray(v) || v.length !== 2) {
          throw new Error(`Expected 2-element array, got ${JSON.stringify(v)}`);
        }
        const [n, b] = v;
        if (typeof n !== "number" || n < 0 || n > 10) {
          throw new Error(`First element out of range [0,10]: ${n}`);
        }
        if (typeof b !== "boolean") {
          throw new Error(`Second element not boolean: ${String(b)}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("all basic, no transforms: generates correct types via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(tuples2(integers(0, 10), booleans()));
        const [n, b] = v;
        if (typeof n !== "number" || n < 0 || n > 10) {
          throw new Error(`First element out of range [0,10]: ${n}`);
        }
        if (typeof b !== "boolean") {
          throw new Error(`Second element not boolean: ${String(b)}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("all basic, one with transform, one without: transform applied correctly", async () => {
    // g2 has no transform; g1 has a transform — covers the t===null branch in applyTransforms
    await runHegelTest(
      async () => {
        const g1 = integers(0, 5).map((x) => x * 3);
        const g2 = integers(0, 5); // no transform
        const gen = tuples2(g1, g2);
        expect(gen).toBeInstanceOf(BasicGenerator);
        const v = await draw(gen);
        const [a, b] = v;
        // a is 0..5 * 3, so 0,3,6,9,12,15
        if (a % 3 !== 0 || a < 0 || a > 15) {
          throw new Error(`a=${a} should be multiple of 3 in [0,15]`);
        }
        if (b < 0 || b > 5) {
          throw new Error(`b=${b} should be in [0,5]`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("tuples3()", () => {
  it("all basic: returns BasicGenerator with 3-element tuple schema", () => {
    const gen = tuples3(integers(), booleans(), text());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<[number, boolean, string]>).schema();
    expect(schema["type"]).toBe("tuple");
    const elems = schema["elements"] as Record<string, unknown>[];
    expect(elems).toHaveLength(3);
    expect(elems[0]).toMatchObject({ type: "integer" });
    expect(elems[1]).toMatchObject({ type: "boolean" });
    expect(elems[2]).toMatchObject({ type: "string" });
  });

  it("non-basic: returns CompositeTupleGenerator", () => {
    const filtered = integers().filter(() => true);
    const gen = tuples3(filtered, booleans(), text());
    expect(gen).toBeInstanceOf(CompositeTupleGenerator);
  });

  it("generates 3-tuples with correct types via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(tuples3(text(), integers(0, 5), floats(0, 1)));
        const [s, n, f] = v;
        if (typeof s !== "string") throw new Error(`First element not string: ${String(s)}`);
        if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 5) {
          throw new Error(`Second element out of range [0,5]: ${n}`);
        }
        if (typeof f !== "number" || f < 0 || f > 1) {
          throw new Error(`Third element out of range [0,1]: ${f}`);
        }
      },
      { testCases: 50 },
    );
  });
});

describe("tuples4()", () => {
  it("all basic: returns BasicGenerator with 4-element tuple schema", () => {
    const gen = tuples4(integers(), booleans(), text(), floats());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<[number, boolean, string, number]>).schema();
    expect(schema["type"]).toBe("tuple");
    const elems = schema["elements"] as Record<string, unknown>[];
    expect(elems).toHaveLength(4);
  });

  it("non-basic: returns CompositeTupleGenerator", () => {
    const filtered = integers().filter(() => true);
    const gen = tuples4(filtered, booleans(), text(), floats());
    expect(gen).toBeInstanceOf(CompositeTupleGenerator);
  });

  it("generates 4-tuples via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(tuples4(integers(0, 10), booleans(), text(0, 5), floats(0, 1)));
        const [n, b, s, f] = v;
        if (typeof n !== "number" || n < 0 || n > 10) {
          throw new Error(`First element out of range [0,10]: ${n}`);
        }
        if (typeof b !== "boolean") throw new Error(`Second element not boolean`);
        if (typeof s !== "string" || Array.from(s).length > 5) {
          throw new Error(`Third element not a short string: ${String(s)}`);
        }
        if (typeof f !== "number" || f < 0 || f > 1) {
          throw new Error(`Fourth element out of range [0,1]: ${f}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("CompositeTupleGenerator", () => {
  it("generates tuple via live server (filtered element > 5)", async () => {
    await runHegelTest(
      async () => {
        const gen = tuples2(
          integers(0, 10).filter((x) => x > 5),
          booleans(),
        );
        const v = await draw(gen);
        const [n, b] = v;
        if (typeof n !== "number" || n <= 5 || n > 10) {
          throw new Error(`First element should be > 5 and <= 10, got ${n}`);
        }
        if (typeof b !== "boolean") throw new Error(`Second element not boolean`);
      },
      { testCases: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// oneOf — Path 1: all basic, no transforms
// ---------------------------------------------------------------------------

describe("oneOf() — Path 1 (all basic, no transforms)", () => {
  it("returns a BasicGenerator with 'one_of' schema when all branches are basic and transform-free", () => {
    const gen = oneOf(integers(), booleans());
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<unknown>).schema();
    expect(schema).toHaveProperty("one_of");
    const branches = schema["one_of"] as unknown[];
    expect(branches).toHaveLength(2);
    // Neither branch should be a tagged tuple
    for (const branch of branches) {
      expect((branch as Record<string, unknown>)["type"]).not.toBe("tuple");
    }
  });

  it("as_basic returns BasicGenerator (path 1)", () => {
    const gen = oneOf(integers(0, 5), integers(10, 15));
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("generates values from one of the branches via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(oneOf(integers(0, 10), integers(100, 200)));
        if (typeof v !== "number") throw new Error(`Expected number, got ${typeof v}`);
        if (!((v >= 0 && v <= 10) || (v >= 100 && v <= 200))) {
          throw new Error(`Value ${v} not in expected ranges`);
        }
      },
      { testCases: 50 },
    );
  });

  it("generates values from both branches across many runs", async () => {
    const low: number[] = [];
    const high: number[] = [];
    await runHegelTest(
      async () => {
        const v = await draw(oneOf(integers(0, 10), integers(100, 200)));
        if ((v as number) <= 10) low.push(v as number);
        else high.push(v as number);
      },
      { testCases: 100 },
    );
    if (low.length === 0) throw new Error("First branch never chosen");
    if (high.length === 0) throw new Error("Second branch never chosen");
  });

  it("throws if 0 generators provided", () => {
    expect(() => oneOf()).toThrow("oneOf requires at least one generator");
  });

  it("accepts 1 generator", () => {
    expect(() => oneOf(integers())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// oneOf — Path 2: all basic, some have transforms (tagged tuples)
// ---------------------------------------------------------------------------

describe("oneOf() — Path 2 (all basic, with transforms)", () => {
  it("returns a BasicGenerator using tagged tuple schemas", () => {
    const gen1 = just(1).map((x) => x * 2); // → 2
    const gen2 = just(2).map((x) => x * 3); // → 6
    const combined = oneOf(gen1, gen2);
    expect(combined).toBeInstanceOf(BasicGenerator);
    const schema = (combined as BasicGenerator<unknown>).schema();
    expect(schema).toHaveProperty("one_of");
    const branches = schema["one_of"] as unknown[];
    expect(branches).toHaveLength(2);
    // Each branch should be a tagged tuple
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i] as Record<string, unknown>;
      expect(branch["type"]).toBe("tuple");
      const elements = branch["elements"] as unknown[];
      expect(elements[0]).toEqual({ const: i });
    }
  });

  it("dispatches tagged transforms correctly via live server", async () => {
    // just(1).map(x*2) → always 2, just(2).map(x*3) → always 6
    await runHegelTest(
      async () => {
        const gen1 = just(1).map((x) => x * 2);
        const gen2 = just(2).map((x) => x * 3);
        const combined = oneOf(gen1, gen2);
        const v = await draw(combined);
        if (v !== 2 && v !== 6) {
          throw new Error(`Expected 2 or 6, got ${v}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("uses path 2 even when only one branch has a transform", () => {
    // just(1).map(x => x * 2) has a transform; integers() does not
    const gen1 = just(1).map((x) => x * 2);
    const gen2 = integers(10, 20); // no transform
    const combined = oneOf(gen1, gen2);
    expect(combined).toBeInstanceOf(BasicGenerator);
    const schema = (combined as BasicGenerator<unknown>).schema();
    const branches = schema["one_of"] as unknown[];
    // Should use tagged tuples since one branch has a transform
    expect((branches[0] as Record<string, unknown>)["type"]).toBe("tuple");
  });

  it("path 2: null transform branch returns value directly", async () => {
    // one branch has transform, one does not: the no-transform branch returns raw value
    await runHegelTest(
      async () => {
        const gen1 = just(1).map((x) => x * 2); // branch 0 → 2
        const gen2 = just(99); // branch 1 → 99, but const schema gives null → transform returns constant
        const combined = oneOf(gen1, gen2);
        const v = await draw(combined);
        if (v !== 2 && v !== 99) {
          throw new Error(`Expected 2 or 99, got ${v}`);
        }
      },
      { testCases: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// oneOf — Path 3: any non-basic generator (CompositeOneOfGenerator)
// ---------------------------------------------------------------------------

describe("oneOf() — Path 3 (composite, non-basic)", () => {
  it("returns CompositeOneOfGenerator when any branch is non-basic", () => {
    const filtered = integers().filter((x) => x > 0);
    const gen = oneOf(filtered, text());
    expect(gen).toBeInstanceOf(CompositeOneOfGenerator);
  });

  it("CompositeOneOfGenerator holds the branches", () => {
    const g1 = integers().filter(() => true);
    const g2 = text();
    const gen = oneOf(g1, g2) as CompositeOneOfGenerator<number | string>;
    expect(gen._generators).toHaveLength(2);
    expect(gen._generators[0]).toBe(g1);
    expect(gen._generators[1]).toBe(g2);
  });

  it("generates values from either branch via live server", async () => {
    await runHegelTest(
      async () => {
        const filtered = integers(0, 10).filter(() => true);
        const v = await draw(oneOf(filtered, text(0, 5)));
        if (typeof v !== "number" && typeof v !== "string") {
          throw new Error(`Expected number or string, got ${typeof v}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("generates from both branches across many runs (composite uses ONE_OF span)", async () => {
    let seenInt = false;
    let seenString = false;
    await runHegelTest(
      async () => {
        const filtered = integers(0, 100).filter(() => true);
        const v = await draw(oneOf(filtered, text(1, 10)));
        if (typeof v === "number") seenInt = true;
        if (typeof v === "string") seenString = true;
      },
      { testCases: 100 },
    );
    if (!seenInt) throw new Error("Integer branch never chosen");
    if (!seenString) throw new Error("String branch never chosen");
  });
});

// ---------------------------------------------------------------------------
// optional
// ---------------------------------------------------------------------------

describe("optional()", () => {
  it("returns a BasicGenerator when element is basic (null + basic = path 1 or 2)", () => {
    // just(null) has a transform, element is basic → path 2 (tagged tuples)
    const gen = optional(integers(0, 10));
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("returns CompositeOneOfGenerator when element is non-basic", () => {
    const filtered = integers(0, 10).filter(() => true);
    const gen = optional(filtered);
    expect(gen).toBeInstanceOf(CompositeOneOfGenerator);
  });

  it("generates null or a value from the element via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(optional(integers(0, 100)));
        if (v !== null && typeof v !== "number") {
          throw new Error(`Expected null or number, got ${typeof v}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("both null and non-null values appear across many runs", async () => {
    let seenNull = false;
    let seenValue = false;
    await runHegelTest(
      async () => {
        const v = await draw(optional(integers(0, 10)));
        if (v === null) seenNull = true;
        else seenValue = true;
      },
      { testCases: 100 },
    );
    if (!seenNull) throw new Error("null never generated by optional()");
    if (!seenValue) throw new Error("non-null value never generated by optional()");
  });

  it("optional with non-basic: both null and values appear", async () => {
    let seenNull = false;
    let seenValue = false;
    await runHegelTest(
      async () => {
        const filtered = integers(0, 10).filter(() => true);
        const v = await draw(optional(filtered));
        if (v === null) seenNull = true;
        else seenValue = true;
      },
      { testCases: 100 },
    );
    if (!seenNull) throw new Error("null never generated by optional(non-basic)");
    if (!seenValue) throw new Error("non-null never generated by optional(non-basic)");
  });
});

// ---------------------------------------------------------------------------
// ipAddresses
// ---------------------------------------------------------------------------

describe("ipAddresses()", () => {
  it("v4: returns BasicGenerator with schema type=ipv4", () => {
    const gen = ipAddresses(4);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect((gen as BasicGenerator<string>).schema()).toEqual({ type: "ipv4" });
  });

  it("v6: returns BasicGenerator with schema type=ipv6", () => {
    const gen = ipAddresses(6);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect((gen as BasicGenerator<string>).schema()).toEqual({ type: "ipv6" });
  });

  it("default (no version): returns a BasicGenerator with one_of schema (v4 and v6 are both basic)", () => {
    const gen = ipAddresses();
    // oneOf(ipAddresses(4), ipAddresses(6)) where both are basic with no transforms → Path 1
    expect(gen).toBeInstanceOf(BasicGenerator);
    const schema = (gen as BasicGenerator<string>).schema();
    expect(schema).toHaveProperty("one_of");
  });

  it("v4: generates strings with dots (IPv4 format) via live server", async () => {
    await runHegelTest(
      async () => {
        const ip = await draw(ipAddresses(4));
        if (typeof ip !== "string" || !ip.includes(".")) {
          throw new Error(`Expected IPv4 with dots, got: ${String(ip)}`);
        }
        const parts = ip.split(".");
        if (parts.length !== 4) {
          throw new Error(`Expected 4 octets, got ${parts.length}: ${ip}`);
        }
        for (const part of parts) {
          const n = Number(part);
          if (!Number.isInteger(n) || n < 0 || n > 255) {
            throw new Error(`Invalid octet: ${part} in ${ip}`);
          }
        }
      },
      { testCases: 50 },
    );
  });

  it("v6: generates strings with colons (IPv6 format) via live server", async () => {
    await runHegelTest(
      async () => {
        const ip = await draw(ipAddresses(6));
        if (typeof ip !== "string" || !ip.includes(":")) {
          throw new Error(`Expected IPv6 with colons, got: ${String(ip)}`);
        }
      },
      { testCases: 50 },
    );
  });

  it("default: generates both IPv4 (dots) and IPv6 (colons) across many runs", async () => {
    let seenV4 = false;
    let seenV6 = false;
    await runHegelTest(
      async () => {
        const ip = await draw(ipAddresses());
        if (typeof ip !== "string") throw new Error(`Expected string, got ${typeof ip}`);
        if (ip.includes(".") && !ip.includes(":")) seenV4 = true;
        if (ip.includes(":")) seenV6 = true;
      },
      { testCases: 100 },
    );
    if (!seenV4) throw new Error("IPv4 never generated by ipAddresses()");
    if (!seenV6) throw new Error("IPv6 never generated by ipAddresses()");
  });
});
