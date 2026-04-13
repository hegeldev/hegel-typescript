/**
 * Tests using fake DataSource implementations to exercise code paths in
 * testCase.ts, generators.ts, and runner.ts that are unreachable through
 * the real hegel server.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TestCase,
  Collection,
  StopTestError,
  AssumeError,
  Labels,
  runTestCase,
  BasicGenerator,
  integers,
  arrays,
  sets,
  maps,
  oneOf,
  optional,
  tuples,
  composite,
  recordGenerator,
  variantGenerator,
  text,
  characters,
  binary,
  booleans,
  sampledFrom,
} from "hegel";
import type { DataSource } from "hegel";

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
  private _aborted: boolean;
  private _markCompleteCalls: Array<{ status: string; origin: string | null }> = [];
  private _newCollectionReturn: number;

  constructor(
    opts: {
      generates?: unknown[];
      throwOnStartSpan?: boolean;
      throwOnStopSpan?: boolean;
      collectionCounts?: number;
      aborted?: boolean;
      newCollectionReturn?: number;
    } = {},
  ) {
    this.generates = opts.generates ?? [];
    this._throwOnStartSpan = opts.throwOnStartSpan ?? false;
    this._throwOnStopSpan = opts.throwOnStopSpan ?? false;
    this._collectionCounts = opts.collectionCounts ?? 0;
    this._aborted = opts.aborted ?? false;
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

  markComplete(status: string, origin: string | null): void {
    this._markCompleteCalls.push({ status, origin });
  }

  testAborted(): boolean {
    return this._aborted;
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
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    tc.draw(integers());
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("draw_1"));
    spy.mockRestore();
  });

  it("note writes to stderr on isLastRun=true", () => {
    const ds = new FakeDataSource({ generates: [] });
    const tc = new TestCase(ds, true);
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    tc.note("hello");
    expect(spy).toHaveBeenCalledWith("hello\n");
    spy.mockRestore();
  });

  it("note does nothing on isLastRun=false", () => {
    const ds = new FakeDataSource({ generates: [] });
    const tc = new TestCase(ds, false);
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    tc.note("hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("testAborted returns dataSource.testAborted()", () => {
    const ds = new FakeDataSource({ aborted: true });
    const tc = new TestCase(ds, false);
    expect(tc.testAborted).toBe(true);
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
    const gen = integers().map((x) => x * 2);
    // This exercises MappedGenerator.doDraw -> asBasic() returns non-null
    expect(tc.draw(gen)).toBe(10);
  });

  it("map on composite returns null from asBasic()", () => {
    const ds = new FakeDataSource({ generates: [7] });
    const tc = new TestCase(ds, false);
    const gen = composite((inner) => inner.draw(integers())).map((x) => x + 1);
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
    expect(() => tc.draw(binary())).toThrow("Expected bytes");
  });

  it("arrays parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(arrays(integers()))).toThrow("Expected array");
  });

  it("sets parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(sets(integers()))).toThrow("Expected array");
  });

  it("maps parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(maps(integers(), integers()))).toThrow("Expected array");
  });

  it("maps parse throws on invalid entry", () => {
    const ds = new FakeDataSource({ generates: [["not a pair"]] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(maps(integers(), integers()))).toThrow("Expected [key, value] pair");
  });

  it("oneOf parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(oneOf(integers(), booleans()))).toThrow("Expected array");
  });

  it("optional parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(optional(integers()))).toThrow("Expected array");
  });

  it("tuples parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    expect(() => tc.draw(tuples(integers(), integers()))).toThrow("Expected array");
  });

  it("recordGenerator parse throws on non-array", () => {
    const ds = new FakeDataSource({ generates: ["not array"] });
    const tc = new TestCase(ds, false);
    const gen = recordGenerator({ x: integers(), y: integers() });
    expect(() => tc.draw(gen)).toThrow("Expected array");
  });
});

// ---------------------------------------------------------------------------
// generators.ts: text/characters with alphabet
// ---------------------------------------------------------------------------

describe("text and characters with alphabet", () => {
  it("text with alphabet option sets schema correctly", () => {
    const gen = text({ alphabet: "abc" });
    expect(gen.schema["categories"]).toEqual([]);
    expect(gen.schema["include_characters"]).toBe("abc");
  });

  it("characters with alphabet option sets schema correctly", () => {
    const gen = characters({ alphabet: "xyz" });
    expect(gen.schema["categories"]).toEqual([]);
    expect(gen.schema["include_characters"]).toBe("xyz");
  });

  it("text generator parses result as string", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(text());
    expect(result).toBe("42");
  });

  it("characters generator parses result as string", () => {
    const ds = new FakeDataSource({ generates: ["a"] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(characters());
    expect(result).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// runner.ts: runTestCase
// ---------------------------------------------------------------------------

describe("runTestCase with fake DataSource", () => {
  it("returns valid for successful test", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const result = runTestCase(
      ds,
      (tc) => {
        tc.draw(integers());
      },
      false,
    );
    expect(result.status).toBe("valid");
    expect(ds.markCompleteCalls).toHaveLength(1);
    expect(ds.markCompleteCalls[0].status).toBe("VALID");
  });

  it("returns invalid when assume(false) is thrown", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const result = runTestCase(
      ds,
      (tc) => {
        tc.draw(integers());
        tc.assume(false);
      },
      false,
    );
    expect(result.status).toBe("invalid");
    expect(ds.markCompleteCalls[0].status).toBe("INVALID");
  });

  it("returns invalid when StopTestError is thrown", () => {
    const ds = new FakeDataSource({ generates: [] });
    const result = runTestCase(
      ds,
      (tc) => {
        tc.draw(integers()); // will throw StopTestError
      },
      false,
    );
    expect(result.status).toBe("invalid");
    expect(ds.markCompleteCalls[0].status).toBe("INVALID");
  });

  it("returns interesting when test throws an Error", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const result = runTestCase(
      ds,
      () => {
        throw new Error("boom");
      },
      false,
    );
    expect(result.status).toBe("interesting");
    expect(ds.markCompleteCalls[0].status).toBe("INTERESTING");
  });

  it("skips markComplete when testAborted is true", () => {
    const ds = new FakeDataSource({ generates: [42], aborted: true });
    const result = runTestCase(
      ds,
      (tc) => {
        tc.draw(integers());
      },
      false,
    );
    expect(result.status).toBe("valid");
    expect(ds.markCompleteCalls).toHaveLength(0);
  });

  it("extractOrigin captures stack trace for interesting results", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const result = runTestCase(
      ds,
      () => {
        throw new Error("test failure");
      },
      false,
    );
    expect(result.status).toBe("interesting");
    // origin should be extracted from the stack trace
    const call = ds.markCompleteCalls[0];
    expect(call.status).toBe("INTERESTING");
    expect(call.origin).toMatch(/^at /);
  });

  it("extractOrigin returns null for non-Error thrown", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const result = runTestCase(
      ds,
      () => {
        throw "string error";
      },
      false,
    );
    expect(result.status).toBe("interesting");
    expect(ds.markCompleteCalls[0].origin).toBeNull();
  });

  it("isFinal=true with interesting result writes to stderr", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = runTestCase(
      ds,
      () => {
        throw new Error("final failure");
      },
      true,
    );
    expect(result.status).toBe("interesting");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("final failure"));
    spy.mockRestore();
  });

  it("isFinal=true with non-Error interesting result writes to stderr", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
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

  it("isFinal=true writes stack trace for Error", () => {
    const ds = new FakeDataSource({ generates: [42] });
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    runTestCase(
      ds,
      () => {
        throw new Error("with stack");
      },
      true,
    );
    // Should have at least two writes: message and stack
    const calls = spy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("with stack"))).toBe(true);
    expect(calls.some((c) => c.includes("at "))).toBe(true);
    spy.mockRestore();
  });

  it("isFinal=true with valid result still logs draws", () => {
    const ds = new FakeDataSource({ generates: [99] });
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const result = runTestCase(
      ds,
      (tc) => {
        tc.draw(integers());
      },
      true,
    );
    expect(result.status).toBe("valid");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("draw_1"));
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// generators.ts: optional returns null for tag=0
// ---------------------------------------------------------------------------

describe("optional parse paths", () => {
  it("optional returns null when tag is 0", () => {
    const ds = new FakeDataSource({ generates: [[0, null]] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(optional(integers()));
    expect(result).toBeNull();
  });

  it("optional returns value when tag is 1", () => {
    const ds = new FakeDataSource({ generates: [[1, 42]] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(optional(integers()));
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: oneOf parse paths
// ---------------------------------------------------------------------------

describe("oneOf parse paths", () => {
  it("oneOf selects the correct generator by tag", () => {
    const ds = new FakeDataSource({ generates: [[1, true]] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(oneOf(integers(), booleans()));
    expect(result).toBe(true);
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
    const result = tc.draw(binary());
    expect(result).toBeInstanceOf(Uint8Array);
    // Buffer extends Uint8Array, so instanceof check returns raw Buffer
    expect(result).toBe(buf);
  });

  it("parseBytes handles Uint8Array input", () => {
    const arr = new Uint8Array([4, 5, 6]);
    const ds = new FakeDataSource({ generates: [arr] });
    const tc = new TestCase(ds, false);
    const result = tc.draw(binary());
    expect(result).toBe(arr);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: variantGenerator
// ---------------------------------------------------------------------------

describe("variantGenerator with fake DataSource", () => {
  it("generates variant with data", () => {
    // sampledFrom will generate an index, then recordGenerator draws fields
    // Tag is index into ["circle", "point"] -> sampledFrom uses integers(0, 1)
    // Index 0 = "circle", then recordGenerator needs a generate for radius
    const ds = new FakeDataSource({ generates: [0, [5.0]] });
    const tc = new TestCase(ds, false);
    type Shape = { type: "circle"; radius: number } | { type: "point" };
    const gen = variantGenerator<Shape>({
      circle: recordGenerator({ radius: integers() }),
      point: null,
    });
    const result = tc.draw(gen);
    expect(result.type).toBe("circle");
    if (result.type === "circle") {
      expect(result.radius).toBe(5);
    }
  });

  it("generates data-less variant", () => {
    const ds = new FakeDataSource({ generates: [1] });
    const tc = new TestCase(ds, false);
    type Shape = { type: "circle"; radius: number } | { type: "point" };
    const gen = variantGenerator<Shape>({
      circle: recordGenerator({ radius: integers() }),
      point: null,
    });
    const result = tc.draw(gen);
    expect(result.type).toBe("point");
  });
});

// ---------------------------------------------------------------------------
// generators.ts: error validation
// ---------------------------------------------------------------------------

describe("Generator validation errors", () => {
  it("integers throws on maxValue < minValue", () => {
    expect(() => integers({ minValue: 10, maxValue: 5 })).toThrow(
      "Cannot have maxValue < minValue",
    );
  });

  it("arrays throws on maxSize < minSize", () => {
    expect(() => arrays(integers(), { minSize: 10, maxSize: 5 })).toThrow(
      "Cannot have maxSize < minSize",
    );
  });

  it("oneOf throws on empty generators", () => {
    expect(() => oneOf()).toThrow("oneOf requires at least one generator");
  });

  it("variantGenerator throws on empty variants", () => {
    expect(() => variantGenerator({})).toThrow("variantGenerator requires at least one variant");
  });

  it("sampledFrom throws on empty array", () => {
    expect(() => sampledFrom([])).toThrow("sampledFrom requires at least one element");
  });
});

// ---------------------------------------------------------------------------
// generators.ts: FilteredGenerator exhaustion
// ---------------------------------------------------------------------------

describe("FilteredGenerator with fake DataSource", () => {
  it("filter retries and returns when predicate passes", () => {
    const ds = new FakeDataSource({ generates: [1, 2, 10] });
    const tc = new TestCase(ds, false);
    const gen = integers().filter((x) => x >= 10);
    expect(tc.draw(gen)).toBe(10);
  });

  it("filter throws AssumeError after 3 failures", () => {
    const ds = new FakeDataSource({ generates: [1, 2, 3] });
    const tc = new TestCase(ds, false);
    const gen = integers().filter((x) => x > 100);
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
    const gen = integers().flatMap((_n) => integers());
    expect(tc.draw(gen)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// generators.ts: BasicGenerator.parseRaw
// ---------------------------------------------------------------------------

describe("BasicGenerator.parseRaw", () => {
  it("parseRaw with no parse function returns raw value", () => {
    const gen = new BasicGenerator<number>({ type: "integer", min_value: 0, max_value: 100 });
    expect(gen.parseRaw(42)).toBe(42);
  });

  it("parseRaw with parse function transforms value", () => {
    const gen = new BasicGenerator<string>({ type: "integer" }, (raw) => String(raw));
    expect(gen.parseRaw(42)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// generators.ts: Generator.asBasic returns null by default
// ---------------------------------------------------------------------------

describe("Generator.asBasic", () => {
  it("composite generator asBasic returns null", () => {
    const gen = composite((tc) => tc.draw(integers()));
    expect(gen.asBasic()).toBeNull();
  });

  it("BasicGenerator asBasic returns itself", () => {
    const gen = integers();
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
    const gen = arrays(
      composite((inner) => inner.draw(integers())),
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
    const gen = sets(
      composite((inner) => inner.draw(integers())),
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
    const gen = maps(
      composite((inner) => inner.draw(integers())),
      composite((inner) => inner.draw(integers())),
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
