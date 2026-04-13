/**
 * TestCase: per-test-case state passed explicitly to test functions.
 *
 * Provides draw(), assume(), note(), span management, and the Collection
 * class for server-managed collection sizing.
 *
 * @packageDocumentation
 */

import { inspect } from "node:util";
import type { Connection, Stream } from "./connection.js";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Generator interface (forward reference to avoid circular imports)
// ---------------------------------------------------------------------------

export interface GeneratorLike<T> {
  doDraw(tc: TestCase): T;
}

// ---------------------------------------------------------------------------
// TestCase
// ---------------------------------------------------------------------------

export class TestCase {
  private stream: Stream;
  private connection: Connection;
  private _isLastRun: boolean;
  private _testAborted = false;
  private drawCount = 0;
  private spanDepth = 0;

  /** @internal */
  constructor(connection: Connection, stream: Stream, isLastRun: boolean) {
    this.connection = connection;
    this.stream = stream;
    this._isLastRun = isLastRun;
  }

  get isLastRun(): boolean {
    return this._isLastRun;
  }

  get testAborted(): boolean {
    return this._testAborted;
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
    const result = this.sendRequest("start_span", { label });
    if (result === null) {
      this.spanDepth--;
      throw new StopTestError();
    }
  }

  /**
   * Stop the current shrinking span.
   */
  stopSpan(discard = false): void {
    this.spanDepth--;
    this.sendRequest("stop_span", { discard });
  }

  /**
   * Send a request to the hegel server.
   * Returns null if the server sends StopTest/overflow.
   * @internal
   */
  sendRequest(command: string, payload: Record<string, unknown> = {}): unknown {
    if (this._testAborted) {
      return null;
    }

    const message: Record<string, unknown> = { command, ...payload };

    try {
      return this.stream.requestCbor(message);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (
        errorMsg.includes("overflow") ||
        errorMsg.includes("StopTest") ||
        errorMsg.includes("Stream is closed")
      ) {
        this.stream.markClosed();
        this._testAborted = true;
        return null;
      }
      if (errorMsg.includes("FlakyStrategyDefinition") || errorMsg.includes("FlakyReplay")) {
        this.stream.markClosed();
        this._testAborted = true;
        return null;
      }
      if (this.connection.hasServerExited()) {
        throw new Error("Server process crashed", { cause: e });
      }
      throw new Error(`Failed to communicate with Hegel: ${errorMsg}`, { cause: e });
    }
  }

  /**
   * Send mark_complete and close the stream.
   * @internal
   */
  sendMarkComplete(markComplete: Record<string, unknown>): void {
    try {
      this.stream.requestCbor(markComplete);
    } catch {
      // ignore errors during mark_complete
    }
    this.stream.close();
  }
}

// ---------------------------------------------------------------------------
// Generate helper
// ---------------------------------------------------------------------------

/**
 * Send a generate command to the server and return the raw result.
 * Throws StopTestError if the server runs out of data.
 * @internal
 */
export function generateRaw(tc: TestCase, schema: Record<string, unknown>): unknown {
  const result = tc.sendRequest("generate", { schema });
  if (result === null) {
    throw new StopTestError();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

/**
 * Server-managed collection sizing.
 *
 * The server determines how many elements to generate based on
 * min_size, max_size, and shrinking state.
 */
export class Collection {
  private tc: TestCase;
  private minSize: number;
  private maxSize: number | undefined;
  private collectionId: number | null = null;
  private finished = false;

  constructor(tc: TestCase, minSize: number, maxSize?: number) {
    this.tc = tc;
    this.minSize = minSize;
    this.maxSize = maxSize;
  }

  private ensureInitialized(): number {
    if (this.collectionId === null) {
      const payload: Record<string, unknown> = {
        min_size: this.minSize,
      };
      if (this.maxSize !== undefined) {
        payload["max_size"] = this.maxSize;
      }
      const result = this.tc.sendRequest("new_collection", payload);
      if (result === null) {
        throw new StopTestError();
      }
      if (typeof result !== "number") {
        throw new Error(`Expected integer from new_collection, got ${typeof result}`);
      }
      this.collectionId = result;
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
    const result = this.tc.sendRequest("collection_more", {
      collection_id: collectionId,
    });
    if (result === null) {
      this.finished = true;
      throw new StopTestError();
    }
    if (typeof result !== "boolean") {
      throw new Error(`Expected boolean from collection_more, got ${typeof result}`);
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
    const payload: Record<string, unknown> = {
      collection_id: collectionId,
    };
    if (why !== undefined) {
      payload["why"] = why;
    }
    this.tc.sendRequest("collection_reject", payload);
  }
}
