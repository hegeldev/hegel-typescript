/**
 * Regression tests for optional(just(null)): absent-null and present-null must
 * use distinct wire schemas so Hegel can choose between the branches.
 */

import { describe, it, expect } from "vitest";
import * as gs from "@hegeldev/hegel/generators";
import { TestCase, type DataSource } from "../src/testCase.js";

class FakeDataSource implements DataSource {
  constructor(private readonly generates: unknown[]) {}

  private index = 0;

  generate(_schema: Record<string, unknown>): unknown {
    return this.generates[this.index++];
  }

  startSpan(_label: number): void {}
  stopSpan(_discard: boolean): void {}
  newCollection(_minSize: number, _maxSize?: number): number {
    return 1;
  }
  collectionMore(_collectionId: number): boolean {
    return false;
  }
  collectionReject(_collectionId: number, _why?: string): void {}
  markComplete(_status: string, _origin: string | null): void {}
  testAborted(): boolean {
    return false;
  }
}

describe("optional(just(null))", () => {
  it("does not send duplicate constant-null branches on the wire", () => {
    const basic = gs.optional(gs.just(null)).asBasic();
    expect(basic).not.toBeNull();

    const generators = (basic!.schema as { generators: Record<string, unknown>[] }).generators;
    expect(generators).toHaveLength(2);
    expect(generators[0]).not.toEqual(generators[1]);
  });

  it("dispatches absent on index 0 and present-null on index 1", () => {
    const absent = new TestCase(new FakeDataSource([[0, null]]), false);
    const present = new TestCase(new FakeDataSource([[1, false]]), false);

    expect(absent.draw(gs.optional(gs.just(null)))).toBeNull();
    expect(present.draw(gs.optional(gs.just(null)))).toBeNull();
    expect(gs.just(null).asBasic()!.schema).toEqual({ type: "constant", value: false });
  });
});
