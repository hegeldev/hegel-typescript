/**
 * Connection management for Hegel SDK.
 * Uses a persistent Python helper subprocess for synchronous socket I/O.
 *
 * The Python helper maintains a single socket connection and communicates
 * via named pipes (FIFOs) for synchronous request/response with Node.js.
 */
import { spawn, ChildProcess, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exit codes for Hegel SDK.
 */
export const EXIT_CODE_SOCKET_ERROR = 134;

/**
 * Module-level state.
 */
let socketPath: string | null = null;
let requestId = 0;
let spanDepth = 0;
let helperProcess: ChildProcess | null = null;
let requestFifo: string | null = null;
let responseFifo: string | null = null;

// Get the directory containing this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Python helper script
const HELPER_SCRIPT = path.join(__dirname, "socket-helper.py");

/**
 * Get the reject code from environment.
 */
function getRejectCode(): number {
  const codeStr = process.env.HEGEL_REJECT_CODE;
  if (!codeStr) {
    console.error("hegel: HEGEL_REJECT_CODE environment variable not set");
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }
  const code = parseInt(codeStr, 10);
  if (isNaN(code)) {
    console.error(
      `hegel: HEGEL_REJECT_CODE is not a valid integer: ${codeStr}`
    );
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }
  return code;
}

/**
 * Assume a condition is true. If false, reject the current test case.
 * This signals to Hegel that the input is invalid, not a test failure.
 */
export function assume(condition: boolean): void {
  if (!condition) {
    process.exit(getRejectCode());
  }
}

/**
 * Print a note for debugging. Visible during test execution.
 */
export function note(message: string): void {
  console.error(message);
}

/**
 * Check if connected to the Hegel socket.
 */
export function isConnected(): boolean {
  return socketPath !== null;
}

/**
 * Get current span depth.
 */
export function getSpanDepth(): number {
  return spanDepth;
}

/**
 * Increment span depth.
 */
export function incrementSpanDepth(): void {
  spanDepth++;
}

/**
 * Decrement span depth.
 */
export function decrementSpanDepth(): void {
  spanDepth--;
}

/**
 * Create FIFOs and start the helper process.
 */
function ensureHelper(): void {
  if (helperProcess) return;

  // Create temp directory and FIFOs
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-ts-"));
  requestFifo = path.join(tmpDir, "request");
  responseFifo = path.join(tmpDir, "response");

  // Create FIFOs using mkfifo
  try {
    execSync(`mkfifo "${requestFifo}"`);
    execSync(`mkfifo "${responseFifo}"`);
  } catch (err) {
    console.error(`hegel: failed to create FIFOs: ${(err as Error).message}`);
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }

  // Start helper process
  helperProcess = spawn("python3", [HELPER_SCRIPT, requestFifo, responseFifo], {
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
  });

  helperProcess.on("error", (err) => {
    console.error(`hegel: helper error: ${err.message}`);
    process.exit(EXIT_CODE_SOCKET_ERROR);
  });

  helperProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`hegel: helper exited with code ${code}`);
    }
    helperProcess = null;
  });

  // Don't let the helper keep Node.js alive
  helperProcess.unref();

  // Register cleanup
  const doCleanup = () => {
    cleanup();
    if (requestFifo) {
      try { fs.unlinkSync(requestFifo); } catch {}
    }
    if (responseFifo) {
      try { fs.unlinkSync(responseFifo); } catch {}
    }
    if (tmpDir) {
      try { fs.rmdirSync(tmpDir); } catch {}
    }
  };

  process.on("exit", doCleanup);
  process.on("SIGINT", () => { doCleanup(); process.exit(130); });
  process.on("SIGTERM", () => { doCleanup(); process.exit(143); });
}

/**
 * Send a command to the helper and wait synchronously for response.
 */
function sendToHelper(command: string): string {
  if (!requestFifo || !responseFifo) {
    console.error("hegel: helper FIFOs not initialized");
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }

  // Write request to request FIFO (blocks until Python reads it)
  fs.writeFileSync(requestFifo, command + "\n");

  // Read response from response FIFO (blocks until Python writes it)
  const response = fs.readFileSync(responseFifo, "utf8").trim();

  return response;
}

/**
 * Open connection to Hegel socket.
 */
export function openConnection(): void {
  if (socketPath !== null) return;

  const envSocket = process.env.HEGEL_SOCKET;
  if (!envSocket) {
    console.error("hegel: HEGEL_SOCKET environment variable not set");
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }

  // Start helper process if not running
  ensureHelper();

  // Send OPEN command
  const response = sendToHelper(`OPEN ${envSocket}`);
  let result: { ok?: boolean; error?: string };
  try {
    result = JSON.parse(response);
  } catch {
    console.error(`hegel: failed to parse OPEN response: ${response}`);
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }

  if (result.error) {
    console.error(`hegel: connection error: ${result.error}`);
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }

  socketPath = envSocket;
}

/**
 * Close connection to Hegel socket.
 */
export function closeConnection(): void {
  if (socketPath === null) return;

  // Send CLOSE command
  const response = sendToHelper("CLOSE");
  // Ignore parse errors on close

  socketPath = null;
}

const DEBUG = process.env.HEGEL_DEBUG === "1" || process.env.HEGEL_DEBUG === "true";

function debug(msg: string): void {
  if (DEBUG) {
    console.error(`[ts-sdk] ${msg}`);
  }
}

/**
 * Cleanup helper process on exit.
 */
function cleanup(): void {
  if (helperProcess) {
    // Just kill the helper - don't try to send QUIT as it may block on FIFO
    try {
      helperProcess.kill("SIGKILL");
    } catch {
      // Ignore
    }
    helperProcess = null;
  }
}

/**
 * Send a request to the Hegel server and wait for a response.
 */
export function sendRequest(
  command: string,
  payload: unknown
): { result?: unknown; error?: string } {
  if (socketPath === null) {
    console.error("hegel: not connected to socket");
    process.exit(EXIT_CODE_SOCKET_ERROR);
  }

  const id = ++requestId;
  const request = { id, command, payload };
  const requestJson = JSON.stringify(request);

  const responseStr = sendToHelper(requestJson);

  let response: { id: number; result?: unknown; error?: string };
  try {
    response = JSON.parse(responseStr);
  } catch (err) {
    assume(false);
  }

  assume(!response!.error);
  assume(response!.id === id);

  return response!;
}

/**
 * Generate a value from a JSON schema.
 */
export function generateFromSchema<T>(schema: Record<string, unknown>): T {
  const needConnection = !isConnected();
  if (needConnection) {
    openConnection();
  }

  const response = sendRequest("generate", schema);

  if (needConnection && getSpanDepth() === 0) {
    closeConnection();
  }

  assume(!response.error);

  return response.result as T;
}
