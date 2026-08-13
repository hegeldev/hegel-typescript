/**
 * Unit tests for the schema interpreter's pure helpers (value formatting and
 * uniqueness keys) and its schema-validation errors. The draw paths themselves
 * are covered by the generator integration tests against the real engine.
 */

import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatTime,
  formatDatetime,
  formatIpv4,
  formatIpv6,
  valueKey,
  generateValue,
} from "../src/generate.js";
import type { Libhegel } from "../src/libhegel.js";

// The schema-validation paths below throw before touching the library.
const unusedLib = null as unknown as Libhegel;

describe("formatDate", () => {
  it("zero-pads all components", () => {
    expect(formatDate({ year: 1, month: 2, day: 3 })).toBe("0001-02-03");
    expect(formatDate({ year: 9999, month: 12, day: 31 })).toBe("9999-12-31");
  });
});

describe("formatTime", () => {
  it("omits the microseconds when zero", () => {
    expect(formatTime({ hour: 0, minute: 0, second: 0, microsecond: 0 })).toBe("00:00:00");
    expect(formatTime({ hour: 23, minute: 59, second: 59, microsecond: 0 })).toBe("23:59:59");
  });

  it("zero-pads microseconds to six digits when nonzero", () => {
    expect(formatTime({ hour: 1, minute: 2, second: 3, microsecond: 42 })).toBe("01:02:03.000042");
    expect(formatTime({ hour: 1, minute: 2, second: 3, microsecond: 999999 })).toBe(
      "01:02:03.999999",
    );
  });
});

describe("formatDatetime", () => {
  it("joins the date and time with a T", () => {
    expect(
      formatDatetime({
        date: { year: 2024, month: 6, day: 7 },
        time: { hour: 8, minute: 9, second: 10, microsecond: 0 },
      }),
    ).toBe("2024-06-07T08:09:10");
  });
});

describe("formatIpv4", () => {
  it("renders dotted-quad", () => {
    expect(formatIpv4(Buffer.from([192, 168, 0, 1]))).toBe("192.168.0.1");
    expect(formatIpv4(Buffer.from([0, 0, 0, 0]))).toBe("0.0.0.0");
  });
});

describe("formatIpv6", () => {
  const ip = (...groups: number[]): Buffer => {
    const bytes = Buffer.alloc(16);
    groups.forEach((g, i) => bytes.writeUInt16BE(g, i * 2));
    return bytes;
  };

  it("renders groups as lowercase hex without leading zeros", () => {
    expect(formatIpv6(ip(0x2001, 0xdb8, 1, 2, 3, 4, 5, 0xabcd))).toBe("2001:db8:1:2:3:4:5:abcd");
  });

  it("compresses the longest zero run, leftmost on ties", () => {
    expect(formatIpv6(ip(1, 0, 0, 2, 0, 0, 0, 3))).toBe("1:0:0:2::3");
    expect(formatIpv6(ip(1, 0, 0, 2, 0, 0, 3, 4))).toBe("1::2:0:0:3:4");
  });

  it("does not compress a lone zero group", () => {
    expect(formatIpv6(ip(1, 0, 2, 3, 4, 5, 6, 7))).toBe("1:0:2:3:4:5:6:7");
  });

  it("compresses leading, trailing and full runs", () => {
    expect(formatIpv6(ip(0, 0, 0, 0, 0, 0, 0, 1))).toBe("::1");
    expect(formatIpv6(ip(1, 0, 0, 0, 0, 0, 0, 0))).toBe("1::");
    expect(formatIpv6(ip(0, 0, 0, 0, 0, 0, 0, 0))).toBe("::");
  });

  it("renders the IPv4-mapped range in mixed notation", () => {
    expect(formatIpv6(ip(0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0001))).toBe("::ffff:192.168.0.1");
  });
});

describe("valueKey", () => {
  it("gives equal-valued numbers and bigints the same key", () => {
    expect(valueKey(5)).toBe(valueKey(5n));
    expect(valueKey(5)).not.toBe(valueKey(6));
    expect(valueKey(5.5)).not.toBe(valueKey(5));
  });

  it("distinguishes values of different kinds", () => {
    const keys = [
      valueKey(null),
      valueKey(1),
      valueKey("1"),
      valueKey(true),
      valueKey(Buffer.from([1])),
      valueKey([1]),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys byte strings by content", () => {
    expect(valueKey(Buffer.from([1, 2]))).toBe(valueKey(new Uint8Array([1, 2])));
    expect(valueKey(Buffer.from([1, 2]))).not.toBe(valueKey(Buffer.from([1, 3])));
  });

  it("keys arrays recursively", () => {
    expect(valueKey([1, [true, null]])).toBe(valueKey([1, [true, null]]));
    expect(valueKey([1, [true, null]])).not.toBe(valueKey([1, [false, null]]));
  });
});

describe("generateValue schema validation", () => {
  it("rejects an unknown schema type", () => {
    expect(() => generateValue(unusedLib, null, null, { type: "mystery" })).toThrow(
      /Unsupported generator schema type: mystery/,
    );
  });

  it("rejects an integer schema with no min_value", () => {
    expect(() => generateValue(unusedLib, null, null, { type: "integer" })).toThrow(
      /integer schema requires min_value/,
    );
  });

  it("rejects an integer schema with no max_value", () => {
    expect(() => generateValue(unusedLib, null, null, { type: "integer", min_value: 0 })).toThrow(
      /integer schema requires max_value/,
    );
  });
});
