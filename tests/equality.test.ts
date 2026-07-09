/**
 * Unit tests for the structural value-equality helper shared by the
 * collection generators' uniqueness checks.
 */

import { describe, it, expect } from "vitest";
import { valuesEqual } from "../src/generators/equality.js";

describe("valuesEqual", () => {
  describe("primitives", () => {
    it("compares equal primitives with ===", () => {
      expect(valuesEqual(1, 1)).toBe(true);
      expect(valuesEqual("a", "a")).toBe(true);
      expect(valuesEqual(true, true)).toBe(true);
      expect(valuesEqual(1n, 1n)).toBe(true);
      expect(valuesEqual(null, null)).toBe(true);
      expect(valuesEqual(undefined, undefined)).toBe(true);
    });

    it("distinguishes unequal primitives", () => {
      expect(valuesEqual(1, 2)).toBe(false);
      expect(valuesEqual("a", "b")).toBe(false);
      expect(valuesEqual(1n, 2n)).toBe(false);
      expect(valuesEqual(undefined, null)).toBe(false);
    });

    it("distinguishes values of different types", () => {
      expect(valuesEqual(1, "1")).toBe(false);
      expect(valuesEqual(1n, 1)).toBe(false);
      expect(valuesEqual(1, NaN)).toBe(false);
      expect(valuesEqual(0, false)).toBe(false);
    });

    it("treats NaN as equal to NaN but not to null", () => {
      expect(valuesEqual(NaN, NaN)).toBe(true);
      expect(valuesEqual(NaN, 1)).toBe(false);
      expect(valuesEqual(NaN, null)).toBe(false);
      expect(valuesEqual(null, NaN)).toBe(false);
    });

    it("treats 0 and -0 as equal (SameValueZero)", () => {
      expect(valuesEqual(0, -0)).toBe(true);
    });
  });

  describe("functions and symbols", () => {
    it("compares functions by reference", () => {
      const f = () => 1;
      const g = () => 1;
      expect(valuesEqual(f, f)).toBe(true);
      expect(valuesEqual(f, g)).toBe(false);
    });

    it("compares symbols by reference", () => {
      const s = Symbol("s");
      expect(valuesEqual(s, s)).toBe(true);
      expect(valuesEqual(s, Symbol("s"))).toBe(false);
    });
  });

  describe("objects vs non-objects", () => {
    it("never equates an object with a primitive or null", () => {
      expect(valuesEqual({}, "x")).toBe(false);
      expect(valuesEqual("x", {})).toBe(false);
      expect(valuesEqual(null, {})).toBe(false);
      expect(valuesEqual({}, null)).toBe(false);
    });
  });

  describe("arrays", () => {
    it("compares element-wise", () => {
      expect(valuesEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(valuesEqual([1, 2], [1, 3])).toBe(false);
      expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it("compares nested structures", () => {
      expect(valuesEqual([[1], { a: 2 }], [[1], { a: 2 }])).toBe(true);
      expect(valuesEqual([[1]], [[2]])).toBe(false);
    });

    it("never equates arrays with non-arrays", () => {
      expect(valuesEqual([], {})).toBe(false);
      expect(valuesEqual({}, [])).toBe(false);
    });
  });

  describe("Uint8Array", () => {
    it("compares byte-wise", () => {
      expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
      expect(valuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
      expect(valuesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    });

    it("never equates Uint8Array with plain objects", () => {
      expect(valuesEqual(new Uint8Array([]), {})).toBe(false);
      expect(valuesEqual({}, new Uint8Array([]))).toBe(false);
    });
  });

  describe("Sets", () => {
    it("compares as unordered collections", () => {
      expect(valuesEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true);
      expect(valuesEqual(new Set([{ a: 1 }, { b: 2 }]), new Set([{ b: 2 }, { a: 1 }]))).toBe(true);
      expect(valuesEqual(new Set([1]), new Set([2]))).toBe(false);
      expect(valuesEqual(new Set([1]), new Set([1, 2]))).toBe(false);
    });

    it("matches structurally duplicate members one-to-one", () => {
      // Two structurally equal (but reference-distinct) members on each side:
      // each left member must consume a distinct right member.
      expect(valuesEqual(new Set([{ v: 1 }, { v: 1 }]), new Set([{ v: 1 }, { v: 1 }]))).toBe(true);
      expect(valuesEqual(new Set([{ v: 1 }, { v: 1 }]), new Set([{ v: 1 }, { v: 2 }]))).toBe(false);
    });

    it("never equates Sets with plain objects", () => {
      expect(valuesEqual(new Set(), {})).toBe(false);
      expect(valuesEqual({}, new Set())).toBe(false);
    });
  });

  describe("Maps", () => {
    it("compares as unordered collections of entries", () => {
      expect(
        valuesEqual(
          new Map([
            [1, "a"],
            [2, "b"],
          ]),
          new Map([
            [2, "b"],
            [1, "a"],
          ]),
        ),
      ).toBe(true);
      expect(valuesEqual(new Map([[1, "a"]]), new Map([[1, "b"]]))).toBe(false);
      expect(valuesEqual(new Map([[1, "a"]]), new Map([[2, "a"]]))).toBe(false);
      expect(
        valuesEqual(
          new Map([[1, "a"]]),
          new Map([
            [1, "a"],
            [2, "b"],
          ]),
        ),
      ).toBe(false);
    });

    it("never equates Maps with plain objects", () => {
      expect(valuesEqual(new Map(), {})).toBe(false);
      expect(valuesEqual({}, new Map())).toBe(false);
    });
  });

  describe("Dates", () => {
    it("compares by timestamp", () => {
      expect(valuesEqual(new Date(0), new Date(0))).toBe(true);
      expect(valuesEqual(new Date(0), new Date(1))).toBe(false);
      expect(valuesEqual(new Date(NaN), new Date(NaN))).toBe(true);
    });

    it("never equates Dates with plain objects", () => {
      expect(valuesEqual(new Date(0), {})).toBe(false);
      expect(valuesEqual({}, new Date(0))).toBe(false);
    });
  });

  describe("plain objects", () => {
    it("compares own enumerable properties", () => {
      expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
      expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(valuesEqual({ a: 1 }, { b: 1 })).toBe(false);
      expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it("compares nested structures", () => {
      expect(valuesEqual({ a: { b: [1, NaN] } }, { a: { b: [1, NaN] } })).toBe(true);
      expect(valuesEqual({ a: { b: [1] } }, { a: { b: [2] } })).toBe(false);
    });
  });
});
