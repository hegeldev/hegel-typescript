/**
 * Tests using fake DataSource implementations to exercise code paths in
 * testCase.ts, generators.ts, and runner.ts that are unreachable through
 * the real hegel server.
 */

import { describe, it, expect, vi } from "vitest";
import * as gs from "@hegeldev/hegel/generators";
import {
  AssumeError,
  Collection,
  Labels,
  StopTestError,
  TestCase,
  type DataSource,
} from "../src/testCase.js";
import { runTestCase } from "../src/runner.js";

// ---------------------------------------------------------------------------
// FakeDataSource
// ---------------------------------------------------------------------------

class FakeDataSource implements DataSource {
  private generates: unknown[];
  private generateIndex = 0;
  private _throwOnStartSpan: boolean;
  private _throwOnStopSpan: boolean;
  private _collectionCounts: number;
  private _collectionCallCount = 0;
  private _markCompleteCalls: Array<{ status: number; origin: string | null }> = [];
  private _newCollectionReturn: number;

  constructor(
    opts: {
      generates?: unknown[];
      throwOnStartSpan?: boolean;
      throwOnStopSpan?: boolean;
      collectionCounts?: number;
      newCollectionReturn?: number;
    } = {},
  ) {
    this.generates = opts.generates ?? [];
    this._throwOnStartSpan = opts.throwOnStartSpan ?? false;
    this._throwOnStopSpan = opts.throwOnStopSpan ?? false;
    this._collectionCounts = opts.collectionCounts ?? 0;
    this._newCollectionReturn = opts.newCollectionReturn ?? 1;
  }

  generate(schema: Record<string, unknown>): unknown {
    void schema;
    if (this.generateIndex >= this.generates.length) {
      throw new StopTestError();
    }
    return this.generates[this.generateIndex++];
  }

  startSpan(label: number): void {
    void label;
    if (this._throwOnStartSpan) {
      throw new Error("startSpan error");
    }
  }

  stopSpan(discard: boolean): void {
    void discard;
    if (this._throwOnStopSpan) {
      throw new Error("stopSpan error");
    }
  }

  newCollection(_minSize: number, _maxSize?: number): number {
    return this._newCollectionReturn;
  }

  collectionMore(_collectionId: number): boolean {
    this._collectionCallCount++;
    return this._collectionCallCount <= this._collectionCounts;
  }

  collectionReject(_collectionId: number, _why?: string): void {
    // no-op
  }

  markComplete(status: number, origin: string | null): void {
    this._markCompleteCalls.push({ status, origin });
  }

  get markCompleteCalls() {
    return this._markCompleteCalls;
  }
}

// ---------------------------------------------------------------------------
// testCase.ts
// ---------------------------------------------------------------------------

describe("TestCase with fake DataSource", () => {
  it("isLastRun getter returns true when constructed with isLastRun=true", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const tc = new TestCase(ds, true);
    expect(tc.isLastRun).toBe(true);
  });

  it("isLastRun getter returns false when constructed with isLastRun=false", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const tc = new TestCase(ds, false);
    expect(tc.isLastRun).toBe(false);
  });

  it("stopSpan catches errors from dataSource.stopSpan", () => {
    const ds = new FakeDataSource({ generates: [42], throwOnStopSpan: true });
    const tc = new TestCase(ds, false);
    tc.startSpan(Labels.LIST);
    // stopSpan should NOT throw even though dataSource.stopSpan throws
    expect(() => tc.stopSpan()).not.toThrow();
  });

  it("startSpan catches and re-throws errors from dataSource.startSpan", () => {
    const ds = new FakeDataSource({ generates: [42], throwOnStartSpan: true });
    const tc = new TestCase(ds, false);
    expect(() => tc.startSpan(Labels.LIST)).toThrow("startSpan error");
  });

  it("draw logs to stderr on isLastRun=true at spanDepth=0", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const tc = new TestCase(ds, true);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    tc.draw(gs.integers());
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("draw_1"));
    spy.mockRestore();
  });

  it("note writes to stderr on isLastRun=true", () => {
    const ds = new FakeDataSource({ generates: [] });
    const tc = new TestCase(ds, true);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    tc.note("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("note does nothing on isLastRun=false", () => {
    const ds = new FakeDataSource({ generates: [] });
    const tc = new TestCase(ds, false);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    tc.note("hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("assume(false) throws AssumeError", () => {
    const ds = new FakeDataSource();
    const tc = new TestCase(ds, false);
    expect(() => tc.assume(false)).toThrow(AssumeError);
  });

  it("assume(true) does not throw", () => {
    const ds = new FakeDataSource();
    const tc = new TestCase(ds, false);
    expect(() => tc.assume(true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

describe("Collection with fake DataSource", () => {
  it("reject when finished is a no-op", () => {
    const ds = new FakeDataSource({ collectionCounts: 0 });
    const tc = new TestCase(ds, false);
    const col = new Collection(tc, 0);
    expect(col.more()).toBe(false);
    // reject after finished should not throw
    col.reject("should be no-op");
  });

  it("more when already finished returns false", () => {
    const ds = new FakeDataSource({ collectionCounts: 0 });
    const tc = new TestCase(ds, false);
    const col = new Collection(tc, 0);
    expect(col.more()).toBe(false);
    expect(col.more()).toBe(false);
  });

  it("collection with elements", () => {
    const ds = new FakeDataSource({ collectionCounts: 2, generates: [10, 20] });
    const tc = new TestCase(ds, false);
    const col = new Collection(tc, 0);
    expect(col.more()).toBe(true);
    expect(col.more()).toBe(true);
    expect(col.more()).toBe(false);
  });

  it("more re-throws and marks finished on error", () => {
    const ds = new FakeDataSource({ collectionCounts: 1 });
    // Override collectionMore to throw
    ds.collectionMore = () => {
      throw new StopTestError();
    };
    const tc = new TestCase(ds, false);
    const col = new Collection(tc, 0);
    expect(() => col.more()).toThrow(StopTestError);
    // After error, more() returns false without calling dataSource again
    expect(col.more()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: MappedGenerator paths
// ---------------------------------------------------------------------------

describe("MappedGenerator with fake DataSource", () => {
  it("map on BasicGenerator uses optimized asBasic() path", () => {
    const ds = new FakeDataSource({ generates: [5] });
    const tc = new TestCase(ds, false);
    const gen = gs.integers().map((x) => x * 2);
    // This exercises MappedGenerator.doDraw -> asBasic() returns non-null
    expect(tc.draw(gen)).toBe(10);
  });

  it("map on composite returns null from asBasic()", () => {
    const ds = new FakeDataSource({ generates: [7] });
    const tc = new TestCase(ds, false);
    const gen = gs.composite((inner) => inner.draw(gs.integers())).map((x) => x + 1);
    // MappedGenerator.asBasic() returns null, uses span-based path
    expect(tc.draw(gen)).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: parse error paths
// ---------------------------------------------------------------------------

describe("Generator parse error paths", () => {
  it("binary parseBytes throws on non-bytes", () => {
    const ds = new FakeDataSource({ generates: ["not bytes"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.binary())).toThrow("Expected bytes");
  });

  it("arrays parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.arrays(gs.integers()))).toThrow("Expected array");
  });

  it("sets parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.sets(gs.integers()))).toThrow("Expected array");
  });

  it("maps parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.maps(gs.integers(), gs.integers()))).toThrow("Expected array");
  });

  it("maps parse throws on invalid entry", () => {
    const ds = new FakeDataSource({ generates: [["not a pair"]] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.maps(gs.integers(), gs.integers()))).toThrow(
      "Expected [key, value] pair",
    );
  });

  it("oneOf parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.oneOf(gs.integers(), gs.booleans()))).toThrow("Expected array");
  });

  it("optional parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.optional(gs.integers()))).toThrow("Expected array");
  });

  it("tuples parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(gs.tuples(gs.integers(), gs.integers()))).toThrow("Expected array");
  });
});

// ---------------------------------------------------------------------------
// generators.ts: text/characters with alphabet
// ---------------------------------------------------------------------------

describe("text and characters with alphabet", () => {
  it("text with alphabet option sets schema correctly", () => {
    const gen = gs.text({ alphabet: "abc" });
    expect(gen.schema["categories"]).toEqual([]);
    expect(gen.schema["include_characters"]).toBe("abc");
  });

  it("characters with alphabet option sets schema correctly", () => {
    const gen = gs.characters({ alphabet: "xyz" });
    expect(gen.schema["categories"]).toEqual([]);
    expect(gen.schema["include_characters"]).toBe("xyz");
  });

  it("text generator parses result as string", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(gs.text());
    expect(result).toBe("42");
  });

  it("characters generator parses result as string", () => {
    const ds = new FakeDataSource({ generates: ["a"] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(gs.characters());
    expect(result).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// runner.ts: branch coverage for non-Error throws
//
// These two tests exercise paths that integration tests cannot reach: real
// test code throws Error instances, but the runner's defensive paths handle
// arbitrary thrown values. Direct calls with a fake DataSource are the only
// way to cover the `String(e)` and `!(e instanceof Error)` branches.
// ---------------------------------------------------------------------------

describe("runTestCase error classification", () => {
  it("classifies a StopTestError thrown by the body as overrun", () => {
    const ds = new FakeDataSource();
    const result = runTestCase(
      ds,
      () => {
        throw new StopTestError();
      },
      false,
    );
    expect(result.status).toBe("overrun");
    expect(ds.markCompleteCalls[0].origin).toBeNull();
  });

  it("integers parse converts a bigint raw value to number", () => {
    const ds = new FakeDataSource({ generates: [5n] });
    const tc = new TestCase(ds, false);
    expect(tc.draw(gs.integers())).toBe(5);
  });
});

describe("runTestCase with non-Error throws", () => {
  it("extractOrigin returns '<unknown>' when a non-Error is thrown", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const result = runTestCase(
      ds,
      () => {
        throw "string error";
      },
      false,
    );
    expect(result.status).toBe("interesting");
    expect(ds.markCompleteCalls[0].origin).toBe("<unknown>");
  });

  it("classifyResult uses String(e) when a non-Error is thrown in final replay", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = runTestCase(
      ds,
      () => {
        throw "string thrown";
      },
      true,
    );
    expect(result.status).toBe("interesting");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("string thrown"));
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// generators.ts: optional returns null for tag=0
// ---------------------------------------------------------------------------

describe("optional parse paths", () => {
  it("optional emits an unwrapped one_of schema with null and inner branches", () => {
    const innerGen = gs.integers({ minValue: 0, maxValue: 10 });
    const basic = gs.optional(innerGen).asBasic();
    expect(basic).not.toBeNull();
    expect(basic!.schema).toEqual({
      type: "one_of",
      generators: [{ type: "constant", value: null }, innerGen.asBasic()!.schema],
    });
    // Guard against re-introducing the legacy tagged-tuple wrapping.
    const generators = (basic!.schema as { generators: Record<string, unknown>[] }).generators;
    expect(generators[0]["type"]).not.toBe("tuple");
    expect(generators[1]["type"]).not.toBe("tuple");
  });

  it("optional returns null when index is 0", () => {
    const ds = new FakeDataSource({ generates: [[0, null]] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(gs.optional(gs.integers()));
    expect(result).toBeNull();
  });

  it("optional returns value when index is 1", () => {
    const ds = new FakeDataSource({ generates: [[1, 42]] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(gs.optional(gs.integers()));
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: oneOf parse paths
// ---------------------------------------------------------------------------

describe("oneOf parse paths", () => {
  it("oneOf basic emits children directly with no tagged-tuple wrapping", () => {
    const basic = gs.oneOf(gs.integers({ minValue: 0, maxValue: 10 }), gs.booleans()).asBasic();
    expect(basic).not.toBeNull();
    expect(basic!.schema).toEqual({
      type: "one_of",
      generators: [{ type: "integer", min_value: 0n, max_value: 10n }, { type: "boolean" }],
    });
    // Guard against accidental re-introduction of the legacy
    // [constant(i), child] tuple wrapping.
    for (const child of (basic!.schema as { generators: Record<string, unknown>[] }).generators) {
      expect(child["type"]).not.toBe("tuple");
    }
  });

  it("oneOf dispatches by index from [index, value] response", () => {
    const ds = new FakeDataSource({ generates: [[1, true]] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(gs.oneOf(gs.integers(), gs.booleans()));
    expect(result).toBe(true);
  });

  it("oneOf routes the value to the matching branch's parseRaw", () => {
    // Branches with different shapes: a string-typed branch and an integer-typed branch.
    const ds0 = new FakeDataSource({ generates: [[0, "abc"]] });
    const tc0 = new TestCase(ds0, false);
    expect(tc0.draw(gs.oneOf<string | number>(gs.text(), gs.integers()))).toBe("abc");

    const ds1 = new FakeDataSource({ generates: [[1, 42]] });
    const tc1 = new TestCase(ds1, false);
    expect(tc1.draw(gs.oneOf<string | number>(gs.text(), gs.integers()))).toBe(42);
  });

  it("oneOf applies the per-branch transform for the chosen index", () => {
    // Branch 0 maps x -> x * 10; branch 1 maps x -> x + 100.
    const branch0 = gs.integers({ minValue: 0, maxValue: 9 }).map((x) => x * 10);
    const branch1 = gs.integers({ minValue: 0, maxValue: 9 }).map((x) => x + 100);
    const ds = new FakeDataSource({ generates: [[0, 7]] });
    const tc0 = new TestCase(ds, false);
    expect(tc0.draw(gs.oneOf(branch0, branch1))).toBe(70);

    const ds2 = new FakeDataSource({ generates: [[1, 7]] });
    const tc1 = new TestCase(ds2, false);
    expect(tc1.draw(gs.oneOf(branch0, branch1))).toBe(107);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: binary parseBytes with Buffer
// ---------------------------------------------------------------------------

describe("binary parse paths", () => {
  it("parseBytes handles Buffer input", () => {
    const buf = Buffer.from([1, 2, 3]);
    const ds = new FakeDataSource({ generates: [buf] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(gs.binary());
    expect(result).toBeInstanceOf(Uint8Array);
    // Buffer extends Uint8Array, so instanceof check returns raw Buffer
    expect(result).toBe(buf);
  });

  it("parseBytes handles Uint8Array input", () => {
    const arr = new Uint8Array([4, 5, 6]);
    const ds = new FakeDataSource({ generates: [arr] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(gs.binary());
    expect(result).toBe(arr);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: error validation
// ---------------------------------------------------------------------------

describe("Generator validation errors", () => {
  it("integers throws on maxValue < minValue", () => {
    expect(() => gs.integers({ minValue: 10, maxValue: 5 })).toThrow(
      "Cannot have maxValue < minValue",
    );
  });

  it("arrays throws on maxSize < minSize", () => {
    expect(() => gs.arrays(gs.integers(), { minSize: 10, maxSize: 5 })).toThrow(
      "Cannot have maxSize < minSize",
    );
  });

  it("oneOf throws on empty generators", () => {
    expect(() => gs.oneOf()).toThrow("oneOf requires at least one generator");
  });

  it("sampledFrom throws on empty array", () => {
    expect(() => gs.sampledFrom([])).toThrow("sampledFrom requires at least one element");
  });
});

// ---------------------------------------------------------------------------
// generators.ts: FilteredGenerator exhaustion
// ---------------------------------------------------------------------------

describe("FilteredGenerator with fake DataSource", () => {
  it("filter retries and returns when predicate passes", () => {
    const ds = new FakeDataSource({ generates: [1, 2, 10] });
    const tc = new TestCase(ds, false);
    const gen = gs.integers().filter((x) => x >= 10);
    expect(tc.draw(gen)).toBe(10);
  });

  it("filter throws AssumeError after 3 failures", () => {
    const ds = new FakeDataSource({ generates: [1, 2, 3] });
    const tc = new TestCase(ds, false);
    const gen = gs.integers().filter((x) => x > 100);
    expect(() => tc.draw(gen)).toThrow(AssumeError);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: FlatMappedGenerator
// ---------------------------------------------------------------------------

describe("FlatMappedGenerator with fake DataSource", () => {
  it("flatMap draws from source then from derived generator", () => {
    // First generate returns the source value, second returns the derived value
    const ds = new FakeDataSource({ generates: [3, 42] });
    const tc = new TestCase(ds, false);
    const gen = gs.integers().flatMap((_n) => gs.integers());
    expect(tc.draw(gen)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: BasicGenerator.parseRaw
// ---------------------------------------------------------------------------

describe("BasicGenerator.parseRaw", () => {
  it("parseRaw with no parse function returns raw value", () => {
    const gen = new gs.BasicGenerator<number>({ type: "integer", min_value: 0, max_value: 100 });
    expect(gen.parseRaw(42)).toBe(42);
  });

  it("parseRaw with parse function transforms value", () => {
    const gen = new gs.BasicGenerator<string>({ type: "integer" }, (raw) => String(raw));
    expect(gen.parseRaw(42)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// generators.ts: Generator.asBasic returns null by default
// ---------------------------------------------------------------------------

describe("Generator.asBasic", () => {
  it("composite generator asBasic returns null", () => {
    const gen = gs.composite((tc) => tc.draw(gs.integers()));
    expect(gen.asBasic()).toBeNull();
  });

  it("BasicGenerator.asBasic() returns itself", () => {
    const gen = new gs.BasicGenerator<number>({ type: "integer" });
    expect(gen.asBasic()).toBe(gen);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: collection protocol arrays with composite elements
// ---------------------------------------------------------------------------

describe("Collection protocol via fake DataSource", () => {
  it("arrays with composite elements uses collection protocol", () => {
    const ds = new FakeDataSource({
      generates: [10, 20],
      collectionCounts: 2,
    });
    const tc = new TestCase(ds, false);
    const gen = gs.arrays(
      gs.composite((inner) => inner.draw(gs.integers())),
      { maxSize: 5 },
    );
    const result = tc.draw(gen);
    expect(result).toEqual([10, 20]);
  });

  it("sets with composite elements uses collection protocol", () => {
    const ds = new FakeDataSource({
      generates: [10, 20],
      collectionCounts: 2,
    });
    const tc = new TestCase(ds, false);
    const gen = gs.sets(
      gs.composite((inner) => inner.draw(gs.integers())),
      { maxSize: 5 },
    );
    const result = tc.draw(gen);
    expect(result).toEqual(new Set([10, 20]));
  });

  it("maps with composite elements uses collection protocol", () => {
    const ds = new FakeDataSource({
      generates: [1, 10, 2, 20],
      collectionCounts: 2,
    });
    const tc = new TestCase(ds, false);
    const gen = gs.maps(
      gs.composite((inner) => inner.draw(gs.integers())),
      gs.composite((inner) => inner.draw(gs.integers())),
      { maxSize: 5 },
    );
    const result = tc.draw(gen);
    expect(result).toEqual(
      new Map([
        [1, 10],
        [2, 20],
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Validation error paths
// ---------------------------------------------------------------------------

describe("validation errors", () => {
  it("gs.text() throws when alphabet combined with other char filter options", () => {
    expect(() => gs.text({ alphabet: "abc", minCodepoint: 65 })).toThrow(
      "Cannot combine alphabet with other character filtering options",
    );
  });

  it("gs.text() accepts individual character filter options", () => {
    // Each of these should create a generator without throwing
    expect(gs.text({ codec: "utf-8" }).asBasic()).not.toBeNull();
    expect(gs.text({ minCodepoint: 32, maxCodepoint: 126 }).asBasic()).not.toBeNull();
    expect(gs.text({ categories: ["L", "Nd"] }).asBasic()).not.toBeNull();
    expect(gs.text({ excludeCategories: ["Cc"] }).asBasic()).not.toBeNull();
    expect(gs.text({ includeCharacters: "abc" }).asBasic()).not.toBeNull();
    expect(gs.text({ excludeCharacters: "xyz" }).asBasic()).not.toBeNull();
  });

  it("gs.sets() throws when minSize > maxSize", () => {
    expect(() => gs.sets(gs.integers(), { minSize: 5, maxSize: 2 })).toThrow(
      "Cannot have maxSize < minSize",
    );
  });

  it("gs.maps() throws when minSize > maxSize", () => {
    expect(() => gs.maps(gs.integers(), gs.integers(), { minSize: 5, maxSize: 2 })).toThrow(
      "Cannot have maxSize < minSize",
    );
  });

  it("gs.domains() accepts maxLength option", () => {
    expect(gs.domains({ maxLength: 50 }).asBasic()).not.toBeNull();
  });
});
