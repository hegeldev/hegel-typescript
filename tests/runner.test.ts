/**
 * Tests for the test runner, error classes, Labels, and test lifecycle.
 */

import { describe, test, it, expect } from "vitest";
import * as hegel from "hegel";
import * as gs from "hegel/generators";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("StopTestError", () => {
  it("has correct name and message", () => {
    const e = new hegel.StopTestError();
    expect(e.name).toBe("StopTestError");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("Server ran out of data (StopTest)");
  });
});

describe("AssumeError", () => {
  it("has correct name and message", () => {
    const e = new hegel.AssumeError();
    expect(e.name).toBe("AssumeError");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("Assumption rejected");
  });
});

// ---------------------------------------------------------------------------
// hegel.Labels constants
// ---------------------------------------------------------------------------

describe("Labels", () => {
  it("has correct values", () => {
    expect(hegel.Labels.LIST).toBe(1);
    expect(hegel.Labels.LIST_ELEMENT).toBe(2);
    expect(hegel.Labels.SET).toBe(3);
    expect(hegel.Labels.SET_ELEMENT).toBe(4);
    expect(hegel.Labels.MAP).toBe(5);
    expect(hegel.Labels.MAP_ENTRY).toBe(6);
    expect(hegel.Labels.TUPLE).toBe(7);
    expect(hegel.Labels.ONE_OF).toBe(8);
    expect(hegel.Labels.OPTIONAL).toBe(9);
    expect(hegel.Labels.FIXED_DICT).toBe(10);
    expect(hegel.Labels.FLAT_MAP).toBe(11);
    expect(hegel.Labels.FILTER).toBe(12);
    expect(hegel.Labels.MAPPED).toBe(13);
    expect(hegel.Labels.SAMPLED_FROM).toBe(14);
    expect(hegel.Labels.ENUM_VARIANT).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// assume() behavior
// ---------------------------------------------------------------------------

describe("assume", () => {
  test(
    "assume(true) is a no-op",
    hegel.test((tc) => {
      tc.assume(true);
    }),
  );

  test(
    "assume(false) rejects the test case",
    hegel.test((tc) => {
      const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
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
    hegel.test((tc) => {
      tc.draw(gs.booleans());
      tc.note("should not throw");
    }),
  );
});

// ---------------------------------------------------------------------------
// Failing test detection
// ---------------------------------------------------------------------------

describe("failing test detection", () => {
  test("hegel.test() detects a property failure", () => {
    expect(
      hegel.test((tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
        if (x > 0) {
          throw new Error("Found positive number");
        }
      }),
    ).toThrow("Property test failed");
  });

  test("non-Error thrown value is reported", () => {
    expect(
      hegel.test((tc) => {
        tc.draw(gs.booleans());
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
    new hegel.Hegel((tc) => {
      const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
      expect(x).toBeGreaterThanOrEqual(0);
    })
      .settings({ testCases: 10 })
      .run();
  });

  test(
    "hegel.test() with settings override",
    hegel.test(
      (tc) => {
        const x = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
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
    new hegel.Hegel(() => {}).run();
  });

  test("settings() is chainable", () => {
    const h = new hegel.Hegel((tc) => {
      tc.draw(gs.booleans());
    });
    const result = h.settings({ testCases: 5 });
    expect(result).toBe(h);
    h.run();
  });

  test("databaseKey() is chainable", () => {
    const h = new hegel.Hegel((tc) => {
      tc.draw(gs.booleans());
    });
    const result = h.databaseKey("test-key");
    expect(result).toBe(h);
    h.settings({ testCases: 5 }).run();
  });
});
