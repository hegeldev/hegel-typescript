/**
 * Global session management for the Hegel SDK.
 *
 * Manages a shared `hegeld` subprocess for the test suite. The session starts
 * lazily on first use and cleans up on process exit.
 *
 * The primary public API is {@link runHegelTest} — a free function that takes
 * only a test body. Users never need to manage connections or sessions directly.
 *
 * @packageDocumentation
 */

import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as child_process from "child_process";
import { Connection } from "./connection.js";
import { Client } from "./client.js";

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

/**
 * Find the `hegel` binary.
 * Priority:
 * 1. `<node prefix>/bin/hegel` (when running inside a venv-like prefix)
 * 2. `hegel` on PATH
 * 3. Falls back to the module if installed as a package
 */
export function findHegeld(): string {
  // Check for a venv-installed hegel next to node
  const nodeExec = process.execPath; // e.g. /home/user/.venv/bin/node
  const binDir = path.dirname(nodeExec);
  const venvHegel = path.join(binDir, "hegel");
  if (fs.existsSync(venvHegel)) {
    return venvHegel;
  }

  // Check PATH
  /* c8 ignore start */
  const pathEnv = process.env["PATH"] ?? "";
  /* c8 ignore stop */
  for (const dir of pathEnv.split(path.delimiter)) {
    const candidate = path.join(dir, "hegel");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not found in this dir
    }
  }

  // Fallback: python -m hegel
  return "python3 -m hegel";
}

// ---------------------------------------------------------------------------
// HegelSession
// ---------------------------------------------------------------------------

/**
 * Manages a shared `hegeld` subprocess for a test suite run.
 *
 * Instantiated once per process. Starts lazily on first use and registers
 * an `atexit`-equivalent cleanup via `process.on('exit')`.
 */
export class HegelSession {
  private _process: child_process.ChildProcess | null = null;
  private _sock: net.Socket | null = null;
  private _connection: Connection | null = null;
  private _client: Client | null = null;
  private _tempDir: string | null = null;
  private _starting: Promise<void> | null = null;
  private _cleanupRegistered = false;

  /* c8 ignore next 3 */
  private _hasWorkingClient(): boolean {
    return this._client !== null && (this._connection?.live ?? false);
  }

  /**
   * Start the session (idempotent). Spawns hegeld and connects via Unix socket.
   * Retries up to 50 times waiting for the socket file to appear.
   */
  async start(): Promise<void> {
    if (this._hasWorkingClient()) return;

    // Serialize concurrent start() calls
    if (this._starting !== null) {
      await this._starting;
      return;
    }

    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    this._starting = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    try {
      // Double-check inside the lock (guards against a completed concurrent start)
      /* c8 ignore start */
      if (this._hasWorkingClient()) {
        resolve();
        return;
      }
      /* c8 ignore stop */

      this._tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-"));
      const socketPath = path.join(this._tempDir, "hegel.sock");

      const hegelCmd = findHegeld();
      const cmdArgs = hegelCmd.split(" ");
      cmdArgs.push(socketPath);

      this._process = child_process.spawn(cmdArgs[0], cmdArgs.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Redirect stdout/stderr to our own stderr for visibility
      this._process.stdout?.pipe(process.stderr);
      this._process.stderr?.pipe(process.stderr);

      // Wait for socket file to appear, retrying up to 50 times
      let connected = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        if (fs.existsSync(socketPath)) {
          try {
            const sock = await connectUnixSocket(socketPath);
            this._sock = sock;
            connected = true;
            break;
          } catch {
            /* c8 ignore start */
            await sleep(100);
            /* c8 ignore stop */
          }
        } else {
          await sleep(100);
        }
      }

      if (!connected) {
        this._process.kill();
        throw new Error("Timeout waiting for hegeld to start");
      }

      this._connection = new Connection(this._sock!, { name: "SDK" });
      const client = new Client(this._connection);
      await client._init();
      this._client = client;

      if (!this._cleanupRegistered) {
        /* c8 ignore start */
        process.on("exit", () => this.cleanupSync());
        /* c8 ignore stop */
        this._cleanupRegistered = true;
      }

      resolve();
    } catch (e) {
      // Notify any concurrent waiters of the failure, then clear the mutex.
      // Attach a no-op catch to suppress the unhandled-rejection warning when
      // no concurrent waiter is waiting.
      this._starting!.catch(() => undefined);
      reject(e);
      this._starting = null;
      throw e;
    }

    this._starting = null;
  }

  /**
   * Clean up all resources (connection, process, socket, temp dir).
   * Safe to call multiple times.
   */
  cleanup(): void {
    this.cleanupSync();
  }

  /** Synchronous cleanup for use in process.on('exit'). */
  cleanupSync(): void {
    if (this._connection !== null) {
      try {
        this._connection.close();
      } catch {
        // ignore
      }
      this._connection = null;
      this._client = null;
    }

    if (this._process !== null) {
      try {
        this._process.kill();
      } catch {
        // ignore
      }
      this._process = null;
    }

    if (this._sock !== null) {
      try {
        this._sock.destroy();
      } catch {
        // ignore
      }
      this._sock = null;
    }

    if (this._tempDir !== null) {
      try {
        fs.rmSync(this._tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this._tempDir = null;
    }
  }

  /**
   * Run a property test using the managed session.
   *
   * @param testFn - The test body (async or sync).
   * @param testCases - Number of test cases to generate.
   */
  async runTest(
    testFn: (() => Promise<void> | void) & { name?: string },
    testCases: number,
  ): Promise<void> {
    await this.start();
    const client = this._client!;
    const testName = testFn.name || "test";
    await client.runTest(testName, testFn, testCases);
  }

  // Expose internals for testing
  get process(): child_process.ChildProcess | null {
    return this._process;
  }
  get connection(): Connection | null {
    return this._connection;
  }
  get client(): Client | null {
    return this._client;
  }
  get sock(): net.Socket | null {
    return this._sock;
  }
  get tempDir(): string | null {
    return this._tempDir;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectUnixSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.once("connect", () => resolve(sock));
    /* c8 ignore start */
    sock.once("error", (err) => {
      sock.destroy();
      reject(err);
    });
    /* c8 ignore stop */
    sock.connect(socketPath);
  });
}

// ---------------------------------------------------------------------------
// Global session singleton
// ---------------------------------------------------------------------------

/** The global shared session used by `runHegelTest`. */
export const _session = new HegelSession();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a property-based test using the global Hegel session.
 *
 * The session starts hegeld lazily on first call and reuses it for all tests.
 *
 * @example
 * ```ts
 * import { runHegelTest, generateFromSchema, assume } from "hegel-sdk";
 *
 * await runHegelTest(async function myTest() {
 *   const x = await generateFromSchema({ type: "integer", min_value: 0, max_value: 100 });
 *   assume(typeof x === "number");
 * }, { testCases: 200 });
 * ```
 *
 * @param testFn - The test body to run for each generated case.
 * @param options - Optional configuration.
 */
export async function runHegelTest(
  testFn: (() => Promise<void> | void) & { name?: string },
  options: { testCases?: number } = {},
): Promise<void> {
  const testCases = options.testCases ?? 100;
  await _session.runTest(testFn, testCases);
}

/**
 * Decorator factory for property-based tests.
 *
 * Since TypeScript method decorators are not yet stable for this use case,
 * this is a function wrapper that can be used like:
 *
 * @example
 * ```ts
 * const myTest = hegel(async () => {
 *   const x = await generateFromSchema({ type: "integer", min_value: 0, max_value: 100 });
 * }, { testCases: 200 });
 * // Then call: await myTest();
 * ```
 *
 * @param testFn - The test body.
 * @param options - Optional configuration.
 */
export function hegel(
  testFn: (() => Promise<void> | void) & { name?: string },
  options: { testCases?: number } = {},
): () => Promise<void> {
  const testCases = options.testCases ?? 100;
  const name = testFn.name || "test";
  // Create a named wrapper; the inner named function carries the resolved name.
  const namedFn: (() => Promise<void> | void) & { name?: string } =
    Object.defineProperty(
      async function (): Promise<void> {
        await testFn();
      },
      "name",
      { value: name, writable: false, configurable: true },
    ) as (() => Promise<void> | void) & { name?: string };
  const wrapper = async (): Promise<void> => {
    await _session.runTest(namedFn, testCases);
  };
  return wrapper;
}
