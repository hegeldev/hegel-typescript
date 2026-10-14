import { describe, expectTypeOf, test } from "vitest";
import * as gs from "../src/generators/index.js";

interface Person {
  name: string;
  age: number;
}

describe("gs.record() types", () => {
  test("infers the record type from the schema", () => {
    const g = gs.record({ name: gs.text(), age: gs.integers() });
    expectTypeOf(g).toEqualTypeOf<gs.Generator<{ name: string; age: number }>>();
  });

  test("accepts an interface as the type argument", () => {
    const g = gs.record<Person>({ name: gs.text(), age: gs.integers() });
    expectTypeOf(g).toEqualTypeOf<gs.Generator<Person>>();
  });

  test("accepts an interface with optional fields", () => {
    interface Tagged {
      id: number;
      label?: string;
    }
    const g = gs.record<Tagged>({ id: gs.integers(), label: gs.text() });
    expectTypeOf(g).toEqualTypeOf<gs.Generator<Tagged>>();
  });

  test("rejects a schema whose generator does not match the field type", () => {
    // @ts-expect-error: age must be a Generator<number>
    gs.record<Person>({ name: gs.text(), age: gs.text() });
  });

  test("rejects a schema that is missing a field", () => {
    // @ts-expect-error: age is required by Person
    gs.record<Person>({ name: gs.text() });
  });
});
