/**
 * TestCase: per-test-case state passed explicitly to test functions.
 *
 * Provides draw(), assume(), note(), span management, and the Collection
 * class for server-managed collection sizing.
 *
 * @packageDocumentation
 */

import { inspect } from "node:util";

export class StopTestError extends Error {
  constructor() {
    super("Server ran out of data (StopTest)");
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

export interface GeneratorLike<T> {
  doDraw(tc: TestCase): T;
}

/**
 * Abstraction over the data backend for a test case.
 *
 * The default implementation (ServerDataSource) talks to the hegel server
 * over a multiplexed stream. Custom implementations can be used in tests
 * to inject specific behaviors without a server.
 */
export interface DataSource {
  generate(schema: Record<string, unknown>): unknown;
  startSpan(label: number): void;
  stopSpan(discard: boolean): void;
  newCollection(minSize: number, maxSize?: number): number;
  collectionMore(collectionId: number): boolean;
  collectionReject(collectionId: number, why?: string): void;
  markComplete(status: string, origin: string | null): void;
  testAborted(): boolean;
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

  get isLastRun(): boolean {
    return this._isLastRun;
  }

  get testAborted(): boolean {
    return this._dataSource.testAborted();
  }

  /**
   * Draw a value from a generator.
   */
  draw<T>(generator: GeneratorLike<T>): T {
    const value = generator.doDraw(this);
    if (this.spanDepth === 0) {
      this.drawCount++;
      if (this._isLastRun) {
        process.stderr.write(`var draw_${this.drawCount} = ${inspect(value, { depth: null })};\n`);
      }
    }
    return value;
  }

  /**
   * Draw a value from a generator without recording it in the output.
   * Unlike draw(), this does not print the value during the final replay.
   */
  drawSilent<T>(generator: GeneratorLike<T>): T {
    return generator.doDraw(this);
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
      process.stderr.write(message + "\n");
    }
  }

  /**
   * Start a shrinking span with the given label.
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
   */
  stopSpan(discard = false): void {
    this.spanDepth--;
    try {
      this._dataSource.stopSpan(discard);
    } catch {
      // Ignore errors during stop_span (matches Rust: `let _ = ...`)
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
