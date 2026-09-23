/**
 * TestCase: per-test-case state passed explicitly to test functions.
 *
 * Provides draw(), assume(), note(), span management, and the Collection
 * class for server-managed collection sizing.
 *
 * @packageDocumentation
 */

import { portableDiagnostics, type Diagnostics } from "./runtime.js";
import { EngineError } from "./engine.js";
// Type-only import to avoid a runtime cycle: Generator depends on TestCase.
import type { Generator } from "./generators/core.js";

export class StopTestError extends Error {
  constructor() {
    super("Hegel ran out of data (StopTest)");
    this.name = "StopTestError";
  }
}

export class AssumeError extends Error {
  constructor() {
    super("Assumption rejected");
    this.name = "AssumeError";
  }
}

// ---------------------------------------------------------------------------
// Span labels
// ---------------------------------------------------------------------------

/**
 * The labels this client opens spans with (`hegel_start_span`). To the engine
 * a label is only an identity — two spans with the same label came from the
 * same kind of generator — so any stable `u64` works. libhegel derives the
 * labels for its own spans by hashing `hegel.<kind>` names (see
 * `hegel_label_from_name`), so these small integers cannot collide with them.
 */
export const Labels = {
  LIST: 1,
  LIST_ELEMENT: 2,
  SET: 3,
  SET_ELEMENT: 4,
  MAP: 5,
  MAP_ENTRY: 6,
  TUPLE: 7,
  ONE_OF: 8,
  OPTIONAL: 9,
  FIXED_DICT: 10,
  FLAT_MAP: 11,
  FILTER: 12,
  MAPPED: 13,
  SAMPLED_FROM: 14,
  ENUM_VARIANT: 15,
} as const;

/**
 * Abstraction over the data backend for a test case.
 *
 * The default implementation (NativeDataSource) drives the native libhegel
 * test case via its C ABI. Custom implementations can be used in tests to
 * inject specific behaviors without the engine.
 *
 * `status` passed to {@link DataSource.markComplete} is a `hegel_status_t`
 * value (see {@link Status} in `libhegel.ts`).
 */
export interface DataSource {
  readonly diagnostics?: Diagnostics;
  assertHealthy?(): void;
  generate(schema: Record<string, unknown>): unknown;
  startSpan(label: number): void;
  stopSpan(discard: boolean): void;
  newCollection(minSize: number, maxSize?: number): number;
  collectionMore(collectionId: number): boolean;
  collectionReject(collectionId: number, why?: string): void;
  markComplete(status: number, origin: string | null): void;
}

export class TestCase {
  private _dataSource: DataSource;
  private _isLastRun: boolean;
  private drawCount = 0;
  private spanDepth = 0;

  /** @internal */
  constructor(dataSource: DataSource, isLastRun: boolean) {
    this._dataSource = dataSource;
    this._isLastRun = isLastRun;
  }

  /** @internal */
  dataSource(): DataSource {
    return this._dataSource;
  }

  /** @internal */
  get isLastRun(): boolean {
    return this._isLastRun;
  }

  /**
   * Draw a value from a generator.
   */
  draw<T>(generator: Generator<T>): T {
    const value = generator.doDraw(this);
    if (this.spanDepth === 0) {
      this.drawCount++;
      if (this._isLastRun) {
        (this._dataSource.diagnostics ?? portableDiagnostics).reportFinalValue(
          value,
          this.drawCount,
        );
      }
    }
    return value;
  }

  /**
   * Reject the current test case if the condition is false.
   */
  assume(condition: boolean): void {
    if (!condition) {
      throw new AssumeError();
    }
  }

  /**
   * Note a message that will be displayed during the final replay.
   */
  note(message: string): void {
    if (this._isLastRun) {
      (this._dataSource.diagnostics ?? portableDiagnostics).note(message);
    }
  }

  /**
   * Start a shrinking span with the given label.
   * @internal
   */
  startSpan(label: number): void {
    this.spanDepth++;
    try {
      this._dataSource.startSpan(label);
    } catch (e) {
      this.spanDepth--;
      throw e;
    }
  }

  /**
   * Stop the current shrinking span.
   * @internal
   */
  stopSpan(discard = false): void {
    this.spanDepth--;
    try {
      this._dataSource.stopSpan(discard);
    } catch (error) {
      if (error instanceof EngineError) throw error;
      // Preserve custom data-source behavior; engine faults are never suppressed.
    }
  }
}

/**
 * Send a generate command to the data source and return the raw result.
 * Throws StopTestError if the data source runs out of data.
 * @internal
 */
export function generateRaw(tc: TestCase, schema: Record<string, unknown>): unknown {
  return tc.dataSource().generate(schema);
}

/**
 * Server-managed collection sizing.
 *
 * The server determines how many elements to generate based on
 * min_size, max_size, and shrinking state.
 */
export class Collection {
  private dataSource: DataSource;
  private minSize: number;
  private maxSize: number | undefined;
  private collectionId: number | null = null;
  private finished = false;

  constructor(tc: TestCase, minSize: number, maxSize?: number) {
    this.dataSource = tc.dataSource();
    this.minSize = minSize;
    this.maxSize = maxSize;
  }

  private ensureInitialized(): number {
    if (this.collectionId === null) {
      this.collectionId = this.dataSource.newCollection(this.minSize, this.maxSize);
    }
    return this.collectionId;
  }

  /**
   * Ask the server whether to produce another element.
   */
  more(): boolean {
    if (this.finished) {
      return false;
    }
    const collectionId = this.ensureInitialized();
    let result: boolean;
    try {
      result = this.dataSource.collectionMore(collectionId);
    } catch (e) {
      this.finished = true;
      throw e;
    }
    if (!result) {
      this.finished = true;
    }
    return result;
  }

  /**
   * Reject the last element (don't count towards size budget).
   */
  reject(why?: string): void {
    if (this.finished) return;
    const collectionId = this.ensureInitialized();
    this.dataSource.collectionReject(collectionId, why);
  }
}
