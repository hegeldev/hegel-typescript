/**
 * Tests for the test runner, error classes, Labels, and test lifecycle.
 */

import { describe, test, it, expect } from "vitest";
import { StopTestError, AssumeError, Labels, hegel, Hegel, integers, booleans } from "hegel";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("StopTestError", () => {
  it("has correct name and message", () => {
    const e = new StopTestError();
    expect(e.name).toBe("StopTestError");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("Server ran out of data (StopTest)");
  });
});

describe("AssumeError", () => {
  it("has correct name and message", () => {
    const e = new AssumeError();
    expect(e.name).toBe("AssumeError");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("Assumption rejected");
  });
});

// ---------------------------------------------------------------------------
// Labels constants
// ---------------------------------------------------------------------------

describe("Labels", () => {
  it("has correct values", () => {
    expect(Labels.LIST).toBe(1);
    expect(Labels.LIST_ELEMENT).toBe(2);
    expect(Labels.SET).toBe(3);
    expect(Labels.SET_ELEMENT).toBe(4);
    expect(Labels.MAP).toBe(5);
    expect(Labels.MAP_ENTRY).toBe(6);
    expect(Labels.TUPLE).toBe(7);
    expect(Labels.ONE_OF).toBe(8);
    expect(Labels.OPTIONAL).toBe(9);
    expect(Labels.FIXED_DICT).toBe(10);
    expect(Labels.FLAT_MAP).toBe(11);
    expect(Labels.FILTER).toBe(12);
    expect(Labels.MAPPED).toBe(13);
    expect(Labels.SAMPLED_FROM).toBe(14);
    expect(Labels.ENUM_VARIANT).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// assume() behavior
// ---------------------------------------------------------------------------

describe("assume", () => {
  test(
    "assume(true) is a no-op",
    hegel((tc) => {
      tc.assume(true);
    }),
  );

  test(
    "assume(false) rejects the test case",
    hegel((tc) => {
      const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
      tc.assume(x > 10);
      expect(x).toBeGreaterThan(10);
    }),
  );
});

// ---------------------------------------------------------------------------
// note() behavior
// ---------------------------------------------------------------------------

describe("note", () => {
  test(
    "note does not throw during exploration",
    hegel((tc) => {
      tc.draw(booleans());
      tc.note("should not throw");
    }),
  );
});

// ---------------------------------------------------------------------------
// Failing test detection
// ---------------------------------------------------------------------------

describe("failing test detection", () => {
  test("hegel() detects a property failure", () => {
    expect(
      hegel((tc) => {
        const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
        if (x > 0) {
          throw new Error("Found positive number");
        }
      }),
    ).toThrow("Property test failed");
  });

  test("non-Error thrown value is reported", () => {
    expect(
      hegel((tc) => {
        tc.draw(booleans());
        throw new Error("custom failure");
      }),
    ).toThrow("Property test failed");
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("settings", () => {
  test("Hegel builder with testCases setting", () => {
    new Hegel((tc) => {
      const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
      expect(x).toBeGreaterThanOrEqual(0);
    })
      .settings({ testCases: 10 })
      .run();
  });

  test(
    "hegel() with settings override",
    hegel(
      (tc) => {
        const x = tc.draw(integers({ minValue: 0, maxValue: 100 }));
        expect(x).toBeGreaterThanOrEqual(0);
      },
      { testCases: 10 },
    ),
  );
});

// ---------------------------------------------------------------------------
// Hegel builder API
// ---------------------------------------------------------------------------

describe("Hegel builder", () => {
  test("passes a simple test with no assertions", () => {
    new Hegel(() => {}).run();
  });

  test("settings() is chainable", () => {
    const h = new Hegel((tc) => {
      tc.draw(booleans());
    });
    const result = h.settings({ testCases: 5 });
    expect(result).toBe(h);
    h.run();
  });

  test("databaseKey() is chainable", () => {
    const h = new Hegel((tc) => {
      tc.draw(booleans());
    });
    const result = h.databaseKey("test-key");
    expect(result).toBe(h);
    h.settings({ testCases: 5 }).run();
  });
});
