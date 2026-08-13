import { describe, test, expect } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

describe("gs.text()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.text().asBasic()).not.toBeNull();
  });

  test("generates strings within size bounds", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ minSize: 0, maxSize: 20 }));
        expect(typeof v).toBe("string");
        expect([...v].length).toBeLessThanOrEqual(20);
      },
      { testCases: 20 },
    ));

  test("generates strings with minSize", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ minSize: 5, maxSize: 20 }));
        expect([...v].length).toBeGreaterThanOrEqual(5);
      },
      { testCases: 20 },
    ));

  test("generates strings without maxSize", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text());
        expect(typeof v).toBe("string");
      },
      { testCases: 10 },
    ));
});

describe("gs.characters()", () => {
  test("exposes a schema via asBasic", () => {
    expect(gs.characters().asBasic()).not.toBeNull();
  });

  test("generates single characters", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.characters());
        expect([...v].length).toBe(1);
      },
      { testCases: 20 },
    ));

  test("generates characters without options", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.characters());
        expect([...v].length).toBe(1);
        expect(typeof v).toBe("string");
      },
      { testCases: 20 },
    ));
});

describe("character filtering options", () => {
  test("codec restricts the alphabet", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ codec: "ascii", minSize: 1, maxSize: 5 }));
        for (const ch of v) {
          expect(ch.codePointAt(0)!).toBeLessThan(128);
        }
      },
      { testCases: 20 },
    ));

  test("codepoint bounds restrict the alphabet", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ minCodepoint: 65, maxCodepoint: 90, minSize: 1, maxSize: 5 }));
        expect(v).toMatch(/^[A-Z]+$/);
      },
      { testCases: 20 },
    ));

  test("categories restrict the alphabet", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ categories: ["Nd"], minSize: 1, maxSize: 5 }));
        expect(v).toMatch(/^\p{Nd}+$/u);
      },
      { testCases: 20 },
    ));

  test("excludeCategories removes categories", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ excludeCategories: ["Nd"], minSize: 1, maxSize: 5 }));
        expect(v).not.toMatch(/\p{Nd}/u);
      },
      { testCases: 20 },
    ));

  test("alphabet restricts to the given characters", () =>
    hegel.test(
      (tc) => {
        const v = tc.draw(gs.text({ alphabet: "abc", minSize: 1, maxSize: 5 }));
        expect(v).toMatch(/^[abc]+$/);
      },
      { testCases: 20 },
    ));

  test("includeCharacters and excludeCharacters adjust the alphabet", () =>
    hegel.test(
      (tc) => {
        const included = tc.draw(gs.text({ includeCharacters: "é", maxSize: 5 }));
        expect(typeof included).toBe("string");
        const excluded = tc.draw(gs.text({ excludeCharacters: "a", minSize: 1, maxSize: 5 }));
        expect(excluded).not.toContain("a");
      },
      { testCases: 20 },
    ));

  test("maxSize 0 draws the empty string", () =>
    hegel.test(
      (tc) => {
        expect(tc.draw(gs.text({ maxSize: 0 }))).toBe("");
      },
      { testCases: 5 },
    ));
});
