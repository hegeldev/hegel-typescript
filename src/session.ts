/**
 * Global lazy session that manages the hegel server subprocess.
 *
 * The session is created on first use and persists for the lifetime of
 * the process. It spawns the hegel binary with `--stdio` and communicates
 * over synchronous pipe I/O.
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { Connection, Stream } from "./connection.js";
import { HANDSHAKE_STRING } from "./protocol.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HEGEL_SERVER_VERSION = "0.4.0";
const SUPPORTED_PROTOCOL_MIN = "0.10";
const SUPPORTED_PROTOCOL_MAX = "0.10";
const HEGEL_SERVER_COMMAND_ENV = "HEGEL_SERVER_COMMAND";
const HEGEL_SERVER_DIR = ".hegel";

// ---------------------------------------------------------------------------
// Version parsing
// ---------------------------------------------------------------------------

function parseVersion(s: string): [number, number] {
  const parts = s.split(".");
  if (parts.length !== 2) {
    throw new Error(`Invalid version string '${s}': expected 'major.minor' format`);
  }
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    throw new Error(`Invalid version string '${s}'`);
  }
  return [major, minor];
}

function versionInRange(version: string, min: string, max: string): boolean {
  const v = parseVersion(version);
  const lo = parseVersion(min);
  const hi = parseVersion(max);
  if (v[0] < lo[0] || (v[0] === lo[0] && v[1] < lo[1])) return false;
  if (v[0] > hi[0] || (v[0] === hi[0] && v[1] > hi[1])) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Server log file
// ---------------------------------------------------------------------------

let logFileCounter = 0;

function serverLogFile(): number {
  try {
    fs.mkdirSync(HEGEL_SERVER_DIR, { recursive: true });
  } catch {
    // ignore
  }
  const pid = process.pid;
  const ix = logFileCounter++;
  const path = `${HEGEL_SERVER_DIR}/server.${pid}-${ix}.log`;
  return fs.openSync(path, "a");
}

// ---------------------------------------------------------------------------
// HegelSession
// ---------------------------------------------------------------------------

let session: HegelSession | null = null;

export class HegelSession {
  readonly connection: Connection;
  private _controlStream: Stream;

  private constructor(connection: Connection, controlStream: Stream) {
    this.connection = connection;
    this._controlStream = controlStream;
  }

  get controlStream(): Stream {
    return this._controlStream;
  }

  static get(): HegelSession {
    if (session === null) {
      session = HegelSession.init();
    }
    return session;
  }

  private static init(): HegelSession {
    const { command, args } = hegelCommand();
    const logFd = serverLogFile();

    const child = spawn(command, [...args, "--stdio", "--verbosity", "normal"], {
      stdio: ["pipe", "pipe", logFd],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    // Prevent Node.js from consuming pipe data via its event loop
    child.stdout!.pause();
    child.stdin!.cork();

    // Extract raw file descriptors for synchronous I/O
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readFd = (child.stdout as any)._handle.fd as number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeFd = (child.stdin as any)._handle.fd as number;

    if (typeof readFd !== "number" || typeof writeFd !== "number") {
      child.kill();
      throw new Error("Failed to extract file descriptors from child process pipes");
    }

    const connection = new Connection(readFd, writeFd);
    const control = connection.controlStream();

    // Handshake: raw bytes, not CBOR-encoded
    const handshakePayload = Buffer.from(HANDSHAKE_STRING, "utf-8");
    const reqId = control.sendRequest(handshakePayload);
    const responseBytes = control.receiveReply(reqId);
    const responseStr = responseBytes.toString("utf-8");
    if (!responseStr.startsWith("Hegel/")) {
      child.kill();
      throw new Error(`Bad handshake response: ${JSON.stringify(responseStr)}`);
    }

    const serverVersion = responseStr.slice("Hegel/".length);
    if (!versionInRange(serverVersion, SUPPORTED_PROTOCOL_MIN, SUPPORTED_PROTOCOL_MAX)) {
      child.kill();
      throw new Error(
        `hegel-typescript supports protocol versions ${SUPPORTED_PROTOCOL_MIN} through ${SUPPORTED_PROTOCOL_MAX}, ` +
          `but the connected server is using protocol version ${serverVersion}`,
      );
    }

    // Register cleanup on process exit
    process.on("exit", () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    });

    // Close the log fd since the child has inherited it
    try {
      fs.closeSync(logFd);
    } catch {
      // ignore
    }

    return new HegelSession(connection, control);
  }
}

// ---------------------------------------------------------------------------
// Hegel command discovery
// ---------------------------------------------------------------------------

function hegelCommand(): { command: string; args: string[] } {
  const override = process.env[HEGEL_SERVER_COMMAND_ENV];
  if (override) {
    return { command: override, args: [] };
  }

  // Default: use uv tool run
  return {
    command: "uv",
    args: ["tool", "run", "--from", `hegel-core==${HEGEL_SERVER_VERSION}`, "hegel"],
  };
}
