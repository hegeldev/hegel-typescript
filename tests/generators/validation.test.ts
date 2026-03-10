import { describe, expect, it } from "vitest";
import { integers, floats, booleans, text, binary, lists, dicts, domains, oneOf } from "hegel";

describe("argument validation", () => {
  describe("integers()", () => {
    it("throws when min > max", () => {
      expect(() => integers(10, 5)).toThrow("max_value");
    });

    it("accepts equal bounds", () => {
      expect(() => integers(5, 5)).not.toThrow();
    });
  });

  describe("floats()", () => {
    it("throws when allow_nan=true with min bound", () => {
      expect(() => floats(0, null, true)).toThrow("allow_nan");
    });

    it("throws when allow_nan=true with max bound", () => {
      expect(() => floats(null, 1, true)).toThrow("allow_nan");
    });

    it("throws when allow_nan=true with both bounds", () => {
      expect(() => floats(0, 1, true)).toThrow("allow_nan");
    });

    it("throws when min > max", () => {
      expect(() => floats(10, 5)).toThrow("min_value");
    });

    it("throws when allow_infinity=true with both bounds", () => {
      expect(() => floats(0, 1, false, true)).toThrow("allow_infinity");
    });

    it("accepts allow_infinity=true with only one bound", () => {
      expect(() => floats(0, null, false, true)).not.toThrow();
      expect(() => floats(null, 1, false, true)).not.toThrow();
    });
  });


  describe("text()", () => {
    it("throws when minSize < 0", () => {
      expect(() => text(-1)).toThrow("min_size");
    });

    it("throws when maxSize < 0", () => {
      expect(() => text(0, -1)).toThrow("max_size");
    });

    it("throws when minSize > maxSize", () => {
      expect(() => text(5, 3)).toThrow("max_size");
    });

    it("accepts equal bounds", () => {
      expect(() => text(3, 3)).not.toThrow();
    });

    it("accepts minSize = 0 (default)", () => {
      expect(() => text(0)).not.toThrow();
    });
  });

  describe("binary()", () => {
    it("throws when minSize < 0", () => {
      expect(() => binary(-1)).toThrow("min_size");
    });

    it("throws when maxSize < 0", () => {
      expect(() => binary(0, -1)).toThrow("max_size");
    });

    it("throws when minSize > maxSize", () => {
      expect(() => binary(5, 3)).toThrow("max_size");
    });

    it("accepts equal bounds", () => {
      expect(() => binary(3, 3)).not.toThrow();
    });

    it("accepts minSize = 0 (default)", () => {
      expect(() => binary(0)).not.toThrow();
    });
  });

  describe("lists()", () => {
    it("throws when minSize < 0", () => {
      expect(() => lists(integers(), -1)).toThrow("min_size");
    });

    it("throws when maxSize < 0", () => {
      expect(() => lists(integers(), 0, -1)).toThrow("max_size");
    });

    it("throws when minSize > maxSize", () => {
      expect(() => lists(integers(), 5, 3)).toThrow("max_size");
    });

    it("accepts equal bounds", () => {
      expect(() => lists(integers(), 3, 3)).not.toThrow();
    });
  });

  describe("dicts()", () => {
    it("throws when minSize < 0", () => {
      expect(() => dicts(text(), integers(), -1)).toThrow("min_size");
    });

    it("throws when maxSize < 0", () => {
      expect(() => dicts(text(), integers(), 0, -1)).toThrow("max_size");
    });

    it("throws when minSize > maxSize", () => {
      expect(() => dicts(text(), integers(), 5, 3)).toThrow("max_size");
    });

    it("accepts equal bounds", () => {
      expect(() => dicts(text(), integers(), 3, 3)).not.toThrow();
    });
  });

  describe("domains()", () => {
    it("throws when maxLength < 4", () => {
      expect(() => domains(3)).toThrow("max_length");
    });

    it("throws when maxLength > 255", () => {
      expect(() => domains(256)).toThrow("max_length");
    });

    it("accepts maxLength = 4 (lower bound)", () => {
      expect(() => domains(4)).not.toThrow();
    });

    it("accepts maxLength = 255 (upper bound)", () => {
      expect(() => domains(255)).not.toThrow();
    });

    it("accepts null (no limit)", () => {
      expect(() => domains(null)).not.toThrow();
    });
  });

  describe("oneOf()", () => {
    it("throws when 0 generators provided", () => {
      expect(() => oneOf()).toThrow("oneOf requires at least one generator");
    });

    it("accepts 1 generator", () => {
      expect(() => oneOf(integers())).not.toThrow();
    });

    it("accepts 2 generators", () => {
      expect(() => oneOf(integers(), booleans())).not.toThrow();
    });
  });
});
