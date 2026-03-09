/**
 * Session management for the Hegel SDK.
 *
 * Manages the lifecycle of the hegel subprocess, its Unix socket connection,
 * and the global session used by {@link runHegelTest}.
 *
 * @packageDocumentation
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { Connection } from "./connection.js";
import { Client } from "./runner.js";

// ---------------------------------------------------------------------------
// Pinned hegel-core version
// ---------------------------------------------------------------------------

/** The hegel-core commit this SDK is designed to work with. */
const HEGEL_VERSION = "6e327df2dd42553de12ace94cfbddfbbd9e4bf50";

const HEGEL_CMD_ENV = "HEGEL_CMD";

const HEGEL_DIR = ".hegel";
const VENV_DIR = path.join(HEGEL_DIR, "venv");
const VERSION_FILE = path.join(VENV_DIR, "hegel-version");
const HEGEL_BIN = path.join(VENV_DIR, "bin", "hegel");

function hegelPipSpec(): string {
  return `hegel @ git+ssh://git@github.com/antithesishq/hegel-core.git@${HEGEL_VERSION}`;
}

let cachedHegelPath: string | null = null;

function ensureHegelInstalled(): string {
  // Check cached version
  try {
    const cached = fs.readFileSync(VERSION_FILE, "utf-8").trim();
    if (cached === HEGEL_VERSION && fs.existsSync(HEGEL_BIN)) {
      return HEGEL_BIN;
    }
  } catch {
    // Version file doesn't exist, need to install
  }

  fs.mkdirSync(HEGEL_DIR, { recursive: true });

  process.stderr.write(`Installing hegel (${HEGEL_VERSION.slice(0, 12)}) into ${VENV_DIR}...\n`);

  childProcess.execSync(`uv venv --clear "${VENV_DIR}"`, {
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    childProcess.execSync(`uv pip install --python "${VENV_DIR}/bin/python" "${hegelPipSpec()}"`, {
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch {
    throw new Error(
      `Failed to install hegel (version: ${HEGEL_VERSION}). ` +
        `Set ${HEGEL_CMD_ENV} to a hegel binary path to skip installation.`,
    );
  }

  if (!fs.existsSync(HEGEL_BIN)) {
    throw new Error(`hegel not found at ${HEGEL_BIN} after installation`);
  }

  fs.writeFileSync(VERSION_FILE, HEGEL_VERSION);

  return HEGEL_BIN;
}

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

/**
 * Locate the hegel binary.
 *
 * If `HEGEL_CMD` is set, uses that path directly (the user is responsible
 * for providing the right binary).
 *
 * Otherwise, ensures hegel is installed in `.hegel/venv` at the version
 * specified by `HEGEL_VERSION` and returns the path to that binary.
 */
export function _findHegeld(): string {
  // HEGEL_CMD override
  const override = process.env[HEGEL_CMD_ENV];
  if (override !== undefined) {
    return override;
  }

  if (cachedHegelPath) return cachedHegelPath;
  cachedHegelPath = ensureHegelInstalled();
  return cachedHegelPath;
}

// ---------------------------------------------------------------------------
// HegelSession
// ---------------------------------------------------------------------------

/**
 * Manages a shared hegel subprocess for the test suite.
 *
 * Spawns the hegel binary on first use and keeps it running for all tests.
 * Cleans up automatically when the process exits.
 */
export class HegelSession {
  private _process: childProcess.ChildProcess | null = null;
  private _connection: Connection | null = null;
  private _client: Client | null = null;
  private _tempDir: string | null = null;
  private _startPromise: Promise<void> | null = null;
  private _cleanupRegistered = false;

  private _hasWorkingClient(): boolean {
    return this._client !== null && this._connection !== null && this._connection.live;
  }

  /**
   * Start the hegel subprocess if not already running.
   * Idempotent — safe to call concurrently or multiple times.
   */
  async _start(): Promise<void> {
    if (this._hasWorkingClient()) return;

    // If already starting (concurrent call), wait for the in-flight promise
    if (this._startPromise !== null) {
      await this._startPromise;
      return;
    }

    this._startPromise = this._doStart();
    // Attach a no-op catch to prevent "unhandled rejection" warnings when the
    // promise rejects; the actual rejection is re-thrown by the await below.
    this._startPromise.catch(() => {});
    try {
      await this._startPromise;
    } finally {
      this._startPromise = null;
    }
  }

  private async _doStart(): Promise<void> {
    this._tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-"));
    const socketPath = path.join(this._tempDir, "hegel.sock");

    const hegelCmd = _findHegeld();

    this._process = childProcess.spawn(hegelCmd, [socketPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait up to 50 × 100 ms = 5 s for the socket to appear and accept
    let connected = false;
    for (let i = 0; i < 50; i++) {
      if (fs.existsSync(socketPath)) {
        try {
          const sock = await this._tryConnect(socketPath);
          const connection = new Connection(sock, { name: "SDK" });
          const client = await Client.create(connection);
          this._connection = connection;
          this._client = client;
          connected = true;
          // Register process-exit cleanup once
          if (!this._cleanupRegistered) {
            this._cleanupRegistered = true;
            process.on("exit", this._cleanup.bind(this));
          }
          break;
        } catch {
          // Socket exists but not ready — keep trying
        }
      }
      await _sleep(100);
    }

    if (!connected) {
      this._process!.kill("SIGKILL");
      this._process = null;
      try {
        fs.rmSync(this._tempDir!, { recursive: true, force: true });
      } catch {
        // ignore
      }
      this._tempDir = null;
      throw new Error("Timeout waiting for hegel to start");
    }
  }

  private _tryConnect(socketPath: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(socketPath);
      sock.once("connect", () => resolve(sock));
      sock.once("error", (err) => reject(err));
    });
  }

  /**
   * Clean up the hegel subprocess and socket.
   * Suppresses all errors during cleanup.
   */
  _cleanup(): void {
    try {
      this._connection?.close();
    } catch {
      /* ignore */
    }
    this._connection = null;
    this._client = null;

    if (this._process) {
      try {
        this._process.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      this._process = null;
    }

    if (this._tempDir) {
      try {
        fs.rmSync(this._tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      this._tempDir = null;
    }
  }

  /**
   * Run a property test using the shared hegel process.
   *
   * @param testFn - The test body.
   * @param testCases - Number of test cases to run.
   */
  async runTest(testFn: () => void | Promise<void>, testCases: number): Promise<void> {
    await this._start();
    const client = this._client!;
    await client.runTest(testFn, { testCases });
  }
}

// ---------------------------------------------------------------------------
// Global session
// ---------------------------------------------------------------------------

const _session = new HegelSession();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a property test using the global hegel session.
 *
 * The hegel subprocess starts lazily on the first call and shuts down when
 * the process exits. If the test fails, the original exception is re-raised
 * for a single failure, or an `AggregateError` is thrown for multiple failures.
 *
 * @param testFn - The test function to run (may be async).
 * @param opts - Options: `testCases` (default 100).
 *
 * @example
 * ```typescript
 * await runHegelTest(async () => {
 *   const x = await draw(integers(0, 100));
 *   const y = await draw(integers(0, 100));
 *   expect(x + y).toBe(y + x);
 * }, { testCases: 200 });
 * ```
 */
export async function runHegelTest(
  testFn: () => void | Promise<void>,
  opts: { testCases?: number } = {},
): Promise<void> {
  await _session.runTest(testFn, opts.testCases ?? 100);
}

/**
 * Decorator factory for property-based tests.
 *
 * Returns a wrapper function that calls {@link runHegelTest} with the given
 * options when invoked.
 *
 * @param opts - Options: `testCases` (default 100).
 *
 * @example
 * ```typescript
 * it("addition is commutative", hegel({ testCases: 200 })(async () => {
 *   const a = await draw(integers());
 *   const b = await draw(integers());
 *   expect(a + b).toBe(b + a);
 * }));
 * ```
 */
export function hegel(
  opts: { testCases?: number } = {},
): (testFn: () => void | Promise<void>) => () => Promise<void> {
  return (testFn: () => void | Promise<void>) => {
    const wrapper = async (): Promise<void> => {
      await runHegelTest(testFn, opts);
    };
    Object.defineProperty(wrapper, "name", {
      value: testFn.name || "test",
    });
    return wrapper;
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
