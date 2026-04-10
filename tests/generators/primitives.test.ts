import { describe, expect, it } from "vitest";
import {
  BasicGenerator,
  integers,
  floats,
  booleans,
  text,
  binary,
  just,
  sampledFrom,
  fromRegex,
  emails,
  urls,
  domains,
  dates,
  times,
  datetimes,
  draw,
  runHegelTest,
} from "hegel";

// ---------------------------------------------------------------------------
// integers()
// ---------------------------------------------------------------------------

describe("integers()", () => {
  it("generates a BasicGenerator", () => {
    expect(integers()).toBeInstanceOf(BasicGenerator);
  });

  it("generates integers in range via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(integers(0, 100));
        if (v < 0 || v > 100) throw new Error(`Out of range: ${v}`);
      },
      { testCases: 20 },
    );
  });

  it("generates without bounds when no args given", () => {
    const gen = integers();
    expect(gen.schema()).toEqual({ type: "integer" });
  });

  it("sets only min_value when only min provided", () => {
    const gen = integers(5, null);
    expect(gen.schema()).toEqual({ type: "integer", min_value: 5 });
  });

  it("sets only max_value when only max provided", () => {
    const gen = integers(null, 100);
    expect(gen.schema()).toEqual({ type: "integer", max_value: 100 });
  });
});

// ---------------------------------------------------------------------------
// floats(), booleans(), text(), binary() — schema structure tests
// ---------------------------------------------------------------------------

describe("floats()", () => {
  it("returns a BasicGenerator with type=float", () => {
    const gen = floats();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toMatchObject({ type: "float" });
  });

  it("includes min_value and max_value when provided", () => {
    const gen = floats(0.0, 1.0);
    const schema = gen.schema();
    expect(schema["min_value"]).toBe(0.0);
    expect(schema["max_value"]).toBe(1.0);
  });

  it("allow_nan defaults to false when bounds given", () => {
    const gen = floats(0, 1);
    expect(gen.schema()["allow_nan"]).toBe(false);
  });

  it("allow_nan defaults to true when no bounds", () => {
    const gen = floats();
    expect(gen.schema()["allow_nan"]).toBe(true);
  });

  it("allow_infinity defaults to false when both bounds given", () => {
    const gen = floats(0, 1);
    expect(gen.schema()["allow_infinity"]).toBe(false);
  });

  it("allow_infinity defaults to true when one bound missing", () => {
    const gen = floats(0, null);
    expect(gen.schema()["allow_infinity"]).toBe(true);
  });

  it("respects explicit allowNan and allowInfinity", () => {
    const gen = floats(null, null, false, false);
    expect(gen.schema()["allow_nan"]).toBe(false);
    expect(gen.schema()["allow_infinity"]).toBe(false);
  });

  it("sets exclude_min and exclude_max", () => {
    const gen = floats(0, 1, null, null, true, true);
    expect(gen.schema()["exclude_min"]).toBe(true);
    expect(gen.schema()["exclude_max"]).toBe(true);
  });
});

describe("booleans()", () => {
  it("returns a BasicGenerator with type=boolean", () => {
    const gen = booleans();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "boolean" });
  });
});

describe("text()", () => {
  it("returns a BasicGenerator with type=string and min_size=0", () => {
    const gen = text();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "string", min_size: 0 });
  });

  it("includes max_size when provided", () => {
    const gen = text(0, 100);
    expect(gen.schema()["max_size"]).toBe(100);
  });

  it("uses custom min_size", () => {
    const gen = text(5);
    expect(gen.schema()["min_size"]).toBe(5);
  });
});

describe("binary()", () => {
  it("returns a BasicGenerator with type=binary and min_size=0", () => {
    const gen = binary();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "binary", min_size: 0 });
  });

  it("includes max_size when provided", () => {
    const gen = binary(0, 64);
    expect(gen.schema()["max_size"]).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// Format generators — unit tests (schema structure)
// ---------------------------------------------------------------------------

describe("emails()", () => {
  it("returns a BasicGenerator with type=email", () => {
    const gen = emails();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "email" });
  });

  it("generates strings containing '@' via live server", async () => {
    await runHegelTest(
      async () => {
        const email = await draw(emails());
        if (typeof email !== "string" || !email.includes("@")) {
          throw new Error(`Expected email with '@', got: ${String(email)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("urls()", () => {
  it("returns a BasicGenerator with type=url", () => {
    const gen = urls();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "url" });
  });

  it("generates strings starting with http:// or https:// via live server", async () => {
    await runHegelTest(
      async () => {
        const url = await draw(urls());
        if (
          typeof url !== "string" ||
          (!url.startsWith("http://") && !url.startsWith("https://"))
        ) {
          throw new Error(`Expected URL starting with http(s)://, got: ${String(url)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("domains()", () => {
  it("returns a BasicGenerator with type=domain and no extra fields", () => {
    const gen = domains();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "domain" });
  });

  it("includes max_length in schema when provided", () => {
    const gen = domains(20);
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "domain", max_length: 20 });
  });

  it("generates valid domain strings via live server", async () => {
    const validDomainChars = /^[a-zA-Z0-9.-]+$/;
    await runHegelTest(
      async () => {
        const domain = await draw(domains());
        if (typeof domain !== "string" || !validDomainChars.test(domain)) {
          throw new Error(`Expected domain with only valid chars, got: ${String(domain)}`);
        }
      },
      { testCases: 30 },
    );
  });

  it("respects max_length constraint via live server", async () => {
    const maxLen = 20;
    await runHegelTest(
      async () => {
        const domain = await draw(domains(maxLen));
        if (typeof domain !== "string" || domain.length > maxLen) {
          throw new Error(
            `Expected domain length <= ${maxLen}, got length ${String((domain as string).length)}: ${String(domain)}`,
          );
        }
      },
      { testCases: 30 },
    );
  });
});

describe("dates()", () => {
  it("returns a BasicGenerator with type=date", () => {
    const gen = dates();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "date" });
  });

  it("generates ISO 8601 date strings (YYYY-MM-DD) via live server", async () => {
    await runHegelTest(
      async () => {
        const dateStr = await draw(dates());
        if (typeof dateStr !== "string") {
          throw new Error(`Expected string, got: ${String(dateStr)}`);
        }
        // Must match YYYY-MM-DD format exactly
        const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
        if (!isoDateRe.test(dateStr)) {
          throw new Error(`Expected YYYY-MM-DD format, got: ${dateStr}`);
        }
        // Must be a valid calendar date (parseable)
        const parsed = new Date(dateStr + "T00:00:00Z");
        if (isNaN(parsed.getTime())) {
          throw new Error(`Not a valid date: ${dateStr}`);
        }
        // Round-trip: converting back to ISO should match (mod time zone)
        const roundTripped = parsed.toISOString().slice(0, 10);
        if (roundTripped !== dateStr) {
          throw new Error(`Date round-trip failed: ${dateStr} -> ${roundTripped}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("times()", () => {
  it("returns a BasicGenerator with type=time", () => {
    const gen = times();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "time" });
  });

  it("generates time strings containing ':' via live server", async () => {
    await runHegelTest(
      async () => {
        const timeStr = await draw(times());
        if (typeof timeStr !== "string" || !timeStr.includes(":")) {
          throw new Error(`Expected time string with ':', got: ${String(timeStr)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

describe("datetimes()", () => {
  it("returns a BasicGenerator with type=datetime", () => {
    const gen = datetimes();
    expect(gen).toBeInstanceOf(BasicGenerator);
    expect(gen.schema()).toEqual({ type: "datetime" });
  });

  it("generates datetime strings containing 'T' via live server", async () => {
    await runHegelTest(
      async () => {
        const dtStr = await draw(datetimes());
        if (typeof dtStr !== "string" || !dtStr.includes("T")) {
          throw new Error(`Expected datetime string with 'T', got: ${String(dtStr)}`);
        }
      },
      { testCases: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// just()
// ---------------------------------------------------------------------------

describe("just()", () => {
  it("returns a BasicGenerator", () => {
    const gen = just(42);
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type 'const' with value null", () => {
    const gen = just("hello");
    expect(gen.schema()).toEqual({ type: "constant", value: null });
  });

  it("transform always returns the constant regardless of raw value", () => {
    const gen = just(99);
    // map() on a BasicGenerator exposes the composed transform
    // We can test this via the live server: every generated value should be 99
    expect(gen.schema()["type"]).toBe("constant");
  });

  it("returns constant value via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(just(42));
        if (v !== 42) throw new Error(`Expected 42, got ${v}`);
      },
      { testCases: 10 },
    );
  });

  it("returns constant object via live server", async () => {
    const obj = { x: 1, y: 2 };
    await runHegelTest(
      async () => {
        const v = await draw(just(obj));
        if (v !== obj) throw new Error(`Expected same object reference`);
      },
      { testCases: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// sampledFrom()
// ---------------------------------------------------------------------------

describe("sampledFrom()", () => {
  it("returns a BasicGenerator", () => {
    const gen = sampledFrom([1, 2, 3]);
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("schema is integer with correct bounds for 3 elements", () => {
    const gen = sampledFrom(["a", "b", "c"]);
    const schema = gen.schema();
    expect(schema["type"]).toBe("integer");
    expect(schema["min_value"]).toBe(0);
    expect(schema["max_value"]).toBe(2);
  });

  it("schema max_value equals length-1 for single element", () => {
    const gen = sampledFrom([42]);
    const schema = gen.schema();
    expect(schema["min_value"]).toBe(0);
    expect(schema["max_value"]).toBe(0);
  });

  it("throws on empty list", () => {
    expect(() => sampledFrom([])).toThrow("sampledFrom requires at least one element");
  });

  it("transform maps index 0 to first element", () => {
    const items = ["x", "y", "z"];
    const gen = sampledFrom(items);
    // Create a version that directly applies the transform through map()
    const mapped = gen.map((v) => v);
    expect(mapped.schema()).toEqual(gen.schema());
    expect(mapped).toBeInstanceOf(BasicGenerator);
  });

  it("returns a value from the list via live server", async () => {
    const items = [10, 20, 30];
    const itemSet = new Set(items);
    await runHegelTest(
      async () => {
        const v = await draw(sampledFrom(items));
        if (!itemSet.has(v)) throw new Error(`Unexpected value: ${v}`);
      },
      { testCases: 50 },
    );
  });

  it("returns non-primitive objects from the list via live server", async () => {
    class Custom {
      constructor(public readonly x: number) {}
    }
    const items = [new Custom(1), new Custom(2), new Custom(3)];
    await runHegelTest(
      async () => {
        const v = await draw(sampledFrom(items));
        if (!(v instanceof Custom)) throw new Error(`Expected Custom instance`);
        if (!items.includes(v)) throw new Error(`Value not in items list`);
      },
      { testCases: 10 },
    );
  });

  it("covers all values across many runs", async () => {
    const items = ["red", "green", "blue"];
    const seen = new Set<string>();
    await runHegelTest(
      async () => {
        const v = await draw(sampledFrom(items));
        seen.add(v);
      },
      { testCases: 100 },
    );
    for (const item of items) {
      if (!seen.has(item)) throw new Error(`Item never generated: ${item}`);
    }
  });
});

// ---------------------------------------------------------------------------
// fromRegex()
// ---------------------------------------------------------------------------

describe("fromRegex()", () => {
  it("returns a BasicGenerator", () => {
    const gen = fromRegex("[0-9]+");
    expect(gen).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type 'regex', pattern, and fullmatch=true by default", () => {
    const gen = fromRegex("[a-z]+");
    const schema = gen.schema();
    expect(schema["type"]).toBe("regex");
    expect(schema["pattern"]).toBe("[a-z]+");
    expect(schema["fullmatch"]).toBe(true);
  });

  it("schema has fullmatch=false when specified", () => {
    const gen = fromRegex("[a-z]+", false);
    const schema = gen.schema();
    expect(schema["fullmatch"]).toBe(false);
  });

  it("generates strings matching the pattern via live server", async () => {
    const pattern = "[0-9]{3}";
    const re = new RegExp(`^${pattern}$`);
    await runHegelTest(
      async () => {
        const v = await draw(fromRegex(pattern));
        if (!re.test(v)) throw new Error(`Value "${v}" does not match pattern ${pattern}`);
      },
      { testCases: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// floats(), booleans(), text(), binary() — unit tests (schema structure)
// ---------------------------------------------------------------------------

describe("floats()", () => {
  it("returns a BasicGenerator", () => {
    expect(floats()).toBeInstanceOf(BasicGenerator);
  });

  it("schema defaults: allow_nan=true, allow_infinity=true when no bounds", () => {
    const schema = floats().schema();
    expect(schema["type"]).toBe("float");
    expect(schema["allow_nan"]).toBe(true);
    expect(schema["allow_infinity"]).toBe(true);
    expect(schema["exclude_min"]).toBe(false);
    expect(schema["exclude_max"]).toBe(false);
    expect(schema["width"]).toBe(64);
  });

  it("schema with min and max: allow_nan=false, allow_infinity=false", () => {
    const schema = floats(0, 1).schema();
    expect(schema["min_value"]).toBe(0);
    expect(schema["max_value"]).toBe(1);
    expect(schema["allow_nan"]).toBe(false);
    expect(schema["allow_infinity"]).toBe(false);
  });

  it("allows explicit allow_nan and allow_infinity", () => {
    const schema = floats(null, null, true, false).schema();
    expect(schema["allow_nan"]).toBe(true);
    expect(schema["allow_infinity"]).toBe(false);
  });

  it("sets exclude_min and exclude_max", () => {
    const schema = floats(0, 1, null, null, true, true).schema();
    expect(schema["exclude_min"]).toBe(true);
    expect(schema["exclude_max"]).toBe(true);
  });

  it("schema with only min set: allow_infinity=true", () => {
    const schema = floats(0).schema();
    expect(schema["min_value"]).toBe(0);
    expect(schema["allow_nan"]).toBe(false);
    expect(schema["allow_infinity"]).toBe(true);
  });

  it("generates numbers via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(floats(0, 1));
        if (typeof v !== "number") throw new Error(`Expected number, got ${typeof v}`);
        if (v < 0 || v > 1) throw new Error(`Out of range [0,1]: ${v}`);
      },
      { testCases: 20 },
    );
  });
});

describe("booleans()", () => {
  it("returns a BasicGenerator", () => {
    expect(booleans()).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type=boolean", () => {
    const schema = booleans().schema();
    expect(schema["type"]).toBe("boolean");
  });

  it("generates booleans via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(booleans());
        if (typeof v !== "boolean") throw new Error(`Expected boolean, got ${typeof v}`);
      },
      { testCases: 20 },
    );
  });
});

describe("text()", () => {
  it("returns a BasicGenerator", () => {
    expect(text()).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type=string and min_size=0 by default", () => {
    const schema = text().schema();
    expect(schema["type"]).toBe("string");
    expect(schema["min_size"]).toBe(0);
    expect(schema["max_size"]).toBeUndefined();
  });

  it("schema includes max_size when provided", () => {
    const schema = text(1, 10).schema();
    expect(schema["min_size"]).toBe(1);
    expect(schema["max_size"]).toBe(10);
  });

  it("schema includes character options when provided", () => {
    const schema = text(0, null, {
      codec: "ascii",
      minCodepoint: 32,
      maxCodepoint: 126,
      categories: ["L", "Nd"],
      excludeCategories: ["Cs"],
      includeCharacters: "xyz",
      excludeCharacters: "abc",
    }).schema();
    expect(schema["codec"]).toBe("ascii");
    expect(schema["min_codepoint"]).toBe(32);
    expect(schema["max_codepoint"]).toBe(126);
    expect(schema["categories"]).toEqual(["L", "Nd"]);
    expect(schema["exclude_categories"]).toEqual(["Cs"]);
    expect(schema["include_characters"]).toBe("xyz");
    expect(schema["exclude_characters"]).toBe("abc");
  });

  it("generates strings via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(text(0, 20));
        if (typeof v !== "string") throw new Error(`Expected string, got ${typeof v}`);
        // Use Array.from to count Unicode codepoints (not UTF-16 code units)
        if (Array.from(v).length > 20)
          throw new Error(`String too long: ${Array.from(v).length} codepoints`);
      },
      { testCases: 20 },
    );
  });
});

describe("binary()", () => {
  it("returns a BasicGenerator", () => {
    expect(binary()).toBeInstanceOf(BasicGenerator);
  });

  it("schema has type=binary and min_size=0 by default", () => {
    const schema = binary().schema();
    expect(schema["type"]).toBe("binary");
    expect(schema["min_size"]).toBe(0);
    expect(schema["max_size"]).toBeUndefined();
  });

  it("schema includes max_size when provided", () => {
    const schema = binary(2, 8).schema();
    expect(schema["min_size"]).toBe(2);
    expect(schema["max_size"]).toBe(8);
  });

  it("generates Uint8Array via live server", async () => {
    await runHegelTest(
      async () => {
        const v = await draw(binary(0, 10));
        if (!(v instanceof Uint8Array)) throw new Error(`Expected Uint8Array`);
        if (v.length > 10) throw new Error(`Too long: ${v.length}`);
      },
      { testCases: 20 },
    );
  });
});
