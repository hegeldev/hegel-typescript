/**
 * Tuple generators.
 *
 * @packageDocumentation
 */

import { TestCase, Labels } from "../testCase.js";
import { Generator, BasicGenerator } from "./core.js";

class TuplesGenerator extends Generator<unknown[]> {
  private readonly generators: Generator<unknown>[];
  private readonly basic: BasicGenerator<unknown[]> | null;

  constructor(generators: Generator<unknown>[]) {
    super();
    this.generators = generators;

    const basics = generators.map((g) => g.asBasic());
    if (basics.every((b) => b !== null)) {
      const validBasics = basics as BasicGenerator<unknown>[];
      this.basic = new BasicGenerator(
        { type: "tuple", elements: validBasics.map((b) => b.schema) },
        (raw) => {
          if (!Array.isArray(raw)) throw new Error(`Expected array, got ${typeof raw}`);
          return raw.map((v: unknown, i: number) => validBasics[i].parseRaw(v));
        },
      );
    } else {
      this.basic = null;
    }
  }

  doDraw(tc: TestCase): unknown[] {
    if (this.basic) return this.basic.doDraw(tc);
    tc.startSpan(Labels.TUPLE);
    const result = this.generators.map((g) => g.doDraw(tc));
    tc.stopSpan();
    return result;
  }

  override asBasic(): BasicGenerator<unknown[]> | null {
    return this.basic;
  }
}

/** Generate tuples from the given element generators. */
export function tuples<T extends unknown[]>(
  ...generators: { [K in keyof T]: Generator<T[K]> }
): Generator<T> {
  return new TuplesGenerator(generators as Generator<unknown>[]) as unknown as Generator<T>;
}
