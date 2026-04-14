/**
 * Composition generators: composite and record.
 *
 * @packageDocumentation
 */

import { TestCase, Labels } from "../testCase.js";
import { Generator, BasicGenerator, CompositeGenerator } from "./core.js";

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

/** Create a generator from an imperative function. */
export function composite<T>(fn: (tc: TestCase) => T): Generator<T> {
  return new CompositeGenerator(fn);
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Generate plain objects by drawing each field from its generator.
 * Uses the schema-based path (tuple schema) when all fields have asBasic(),
 * otherwise falls back to composite draws with a FIXED_DICT span.
 *
 * @example
 * ```ts
 * const userGen = record({
 *   name: text({ minSize: 1 }),
 *   age: integers({ minValue: 0, maxValue: 120 }),
 *   active: booleans(),
 * });
 * ```
 */
export function record<T extends Record<string, unknown>>(schema: {
  [K in keyof T]: Generator<T[K]>;
}): Generator<T> {
  const keys = Object.keys(schema) as (keyof T & string)[];
  const generators = keys.map((k) => schema[k]);

  const basics = generators.map((g) => g.asBasic());
  if (basics.every((b) => b !== null)) {
    const validBasics = basics as BasicGenerator<unknown>[];
    return new BasicGenerator(
      { type: "tuple", elements: validBasics.map((b) => b.schema) },
      (raw) => {
        /* v8 ignore start: server always returns array for tuple schema */
        if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
        /* v8 ignore stop */
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < keys.length; i++) {
          obj[keys[i]] = validBasics[i].parseRaw(raw[i]);
        }
        return obj as T;
      },
    ) as Generator<T>;
  }

  return new CompositeGenerator((tc: TestCase) => {
    tc.startSpan(Labels.FIXED_DICT);
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      obj[keys[i]] = generators[i].doDraw(tc);
    }
    tc.stopSpan(false);
    return obj as T;
  });
}
