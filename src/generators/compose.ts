/**
 * Composition generators: composite and record.
 *
 * @packageDocumentation
 */

import { TestCase, Labels } from "../testCase.js";
import { Generator, BasicGenerator } from "./core.js";

class ComposedGenerator<T> extends Generator<T> {
  constructor(private readonly fn: (tc: TestCase) => T) {
    super();
  }

  doDraw(tc: TestCase): T {
    return this.fn(tc);
  }
}

/** Create a generator from an imperative function. */
export function composite<T>(fn: (tc: TestCase) => T): Generator<T> {
  return new ComposedGenerator(fn);
}

class RecordGenerator<T extends Record<string, unknown>> extends Generator<T> {
  private readonly keys: (keyof T & string)[];
  private readonly generators: Generator<T[keyof T & string]>[];
  private readonly basic: BasicGenerator<T> | null;

  constructor(schema: { [K in keyof T]: Generator<T[K]> }) {
    super();
    this.keys = Object.keys(schema) as (keyof T & string)[];
    this.generators = this.keys.map((k) => schema[k]) as Generator<T[keyof T & string]>[];

    const basics = this.generators.map((g) => g.asBasic());
    if (basics.every((b) => b !== null)) {
      const validBasics = basics as BasicGenerator<unknown>[];
      const keys = this.keys;
      this.basic = new BasicGenerator(
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
      );
    } else {
      this.basic = null;
    }
  }

  doDraw(tc: TestCase): T {
    if (this.basic) return this.basic.doDraw(tc);
    tc.startSpan(Labels.FIXED_DICT);
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < this.keys.length; i++) {
      obj[this.keys[i]] = this.generators[i].doDraw(tc);
    }
    tc.stopSpan();
    return obj as T;
  }

  override asBasic(): BasicGenerator<T> | null {
    return this.basic;
  }
}

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
  return new RecordGenerator(schema);
}
