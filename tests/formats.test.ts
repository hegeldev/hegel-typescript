import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("gs.emails()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.emails().asBasic()).not.toBeNull();
  });

  test("generates strings containing '@'", () =>
    hegel.test(
      (tc) => {
        const email = tc.draw(gs.emails());
        expect(typeof email).toBe("string");
        expect(email).toContain("@");
      },
      { testCases: 30 },
    ));
});

describe("gs.urls()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.urls().asBasic()).not.toBeNull();
  });

  test("generates strings starting with http:// or https://", () =>
    hegel.test(
      (tc) => {
        const url = tc.draw(gs.urls());
        expect(typeof url).toBe("string");
        expect(url.startsWith("http://") || url.startsWith("https://")).toBe(true);
      },
      { testCases: 30 },
    ));
});

describe("gs.domains()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.domains().asBasic()).not.toBeNull();
  });

  test("generates valid domain strings", () =>
    hegel.test(
      (tc) => {
        const domain = tc.draw(gs.domains());
        expect(typeof domain).toBe("string");
        expect(domain).toMatch(/^[a-zA-Z0-9.-]+$/);
      },
      { testCases: 30 },
    ));
});

describe("gs.dates()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.dates().asBasic()).not.toBeNull();
  });

  test("generates ISO 8601 date strings (YYYY-MM-DD)", () =>
    hegel.test(
      (tc) => {
        const dateStr = tc.draw(gs.dates());
        expect(typeof dateStr).toBe("string");
        expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Must be a valid calendar date
        const parsed = new Date(dateStr + "T00:00:00Z");
        expect(parsed.getTime()).not.toBeNaN();
      },
      { testCases: 30 },
    ));
});

describe("gs.times()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.times().asBasic()).not.toBeNull();
  });

  test("generates time strings containing ':'", () =>
    hegel.test(
      (tc) => {
        const timeStr = tc.draw(gs.times());
        expect(typeof timeStr).toBe("string");
        expect(timeStr).toContain(":");
      },
      { testCases: 30 },
    ));
});

describe("gs.datetimes()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.datetimes().asBasic()).not.toBeNull();
  });

  test("generates datetime strings containing 'T'", () =>
    hegel.test(
      (tc) => {
        const dtStr = tc.draw(gs.datetimes());
        expect(typeof dtStr).toBe("string");
        expect(dtStr).toContain("T");
      },
      { testCases: 30 },
    ));
});

describe("gs.uuids()", () => {
  test("generates canonical non-nil UUID strings", () =>
    hegel.test(
      (tc) => {
        const uuid = tc.draw(gs.uuids());
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(uuid).not.toBe("00000000-0000-0000-0000-000000000000");
      },
      { testCases: 30 },
    ));

  test.each([1, 2, 3, 4, 5] as const)("forces RFC 4122 version %i and variant", (version) =>
    hegel.test(
      (tc) => {
        const uuid = tc.draw(gs.uuids({ version }));
        expect(uuid[14]).toBe(String(version));
        expect(uuid[19]).toMatch(/[89ab]/);
      },
      { testCases: 10 },
    ),
  );

  test("rejects versions outside 1 through 5", () => {
    expect(() => gs.uuids({ version: 9 as 1 })).toThrow("version must be between 1 and 5");
  });
});

describe("gs.ipAddresses()", () => {
  test("gs.ipAddresses({ version: 4 }) generates valid IPv4", () =>
    hegel.test(
      (tc) => {
        const ip = tc.draw(gs.ipAddresses({ version: 4 }));
        expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      },
      { testCases: 10 },
    ));

  test("gs.ipAddresses({ version: 6 }) generates valid IPv6", () =>
    hegel.test(
      (tc) => {
        const ip = tc.draw(gs.ipAddresses({ version: 6 }));
        expect(typeof ip).toBe("string");
        expect(ip).toContain(":");
      },
      { testCases: 10 },
    ));

  test("ipAddresses generates either IPv4 or IPv6", () =>
    hegel.test(
      (tc) => {
        const ip = tc.draw(gs.ipAddresses());
        expect(typeof ip).toBe("string");
      },
      { testCases: 10 },
    ));
});
