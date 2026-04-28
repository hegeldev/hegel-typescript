/**
 * Global lazy session that manages the hegel server subprocess.
 *
 * The session is created on first use and persists for the lifetime of
 * the process.
 *
 * @packageDocumentation
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { Connection, Stream } from "./connection.js";
import { HANDSHAKE_STRING } from "./protocol.js";
import { findUv } from "./uv.js";

export const HEGEL_SERVER_VERSION = "0.4.14";
const SUPPORTED_PROTOCOL_MIN = "0.10";
const SUPPORTED_PROTOCOL_MAX = "0.10";
const HEGEL_SERVER_COMMAND_ENV = "HEGEL_SERVER_COMMAND";
const HEGEL_SERVER_DIR = ".hegel";

function parseVersion(s: string): [number, number] {
  const parts = s.split(".");
  /* v8 ignore start */
  if (parts.length !== 2) {
    throw new Error(`Invalid version string '${s}': expected 'major.minor' format`);
  }
  /* v8 ignore stop */
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  /* v8 ignore start */
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    throw new Error(`Invalid version string '${s}'`);
  }
  /* v8 ignore stop */
  return [major, minor];
}

function versionInRange(version: string, min: string, max: string): boolean {
  const v = parseVersion(version);
  const lo = parseVersion(min);
  const hi = parseVersion(max);
  /* v8 ignore start */
  if (v[0] < lo[0] || (v[0] === lo[0] && v[1] < lo[1])) return false;
  if (v[0] > hi[0] || (v[0] === hi[0] && v[1] > hi[1])) return false;
  /* v8 ignore stop */
  return true;
}

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

    const child = spawn(command, [...args, "--verbosity", "normal"], {
      stdio: ["pipe", "pipe", logFd],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    // Prevent Node.js from consuming pipe data via its event loop
    child.stdout!.pause();
    child.stdin!.cork();

    // Unref the child and its pipes so they don't keep Node's event loop
    // alive. Otherwise a plain `node script.mjs` hangs after the last
    // Hegel.run() completes — Node waits for the subprocess, the subprocess
    // waits for more protocol commands, and the `exit` handler that would
    // kill the child never fires because Node never decides to exit.
    // stdin/stdout for piped stdio are Socket instances at runtime, but
    // TypeScript types them as Writable/Readable which don't declare unref().
    child.unref();
    (child.stdout as unknown as { unref(): void }).unref();
    (child.stdin as unknown as { unref(): void }).unref();

    // Extract raw file descriptors for synchronous I/O
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readFd = (child.stdout as any)._handle.fd as number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeFd = (child.stdin as any)._handle.fd as number;

    const connection = new Connection(readFd, writeFd);
    const control = connection.controlStream();

    // Handshake: raw bytes, not CBOR-encoded
    const handshakePayload = Buffer.from(HANDSHAKE_STRING, "utf-8");
    const reqId = control.sendRequest(handshakePayload);
    const responseBytes = control.receiveReply(reqId);
    const responseStr = responseBytes.toString("utf-8");
    /* v8 ignore start */
    if (!responseStr.startsWith("Hegel/")) {
      child.kill();
      throw new Error(`Bad handshake response: ${JSON.stringify(responseStr)}`);
    }
    /* v8 ignore stop */

    const serverVersion = responseStr.slice("Hegel/".length);
    /* v8 ignore start */
    if (!versionInRange(serverVersion, SUPPORTED_PROTOCOL_MIN, SUPPORTED_PROTOCOL_MAX)) {
      child.kill();
      throw new Error(
        `hegel-typescript supports protocol versions ${SUPPORTED_PROTOCOL_MIN} through ${SUPPORTED_PROTOCOL_MAX}, ` +
          `but the connected server is using protocol version ${serverVersion}`,
      );
    }
    /* v8 ignore stop */

    // Register cleanup on process exit
    /* v8 ignore start */
    process.on("exit", () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    });
    /* v8 ignore stop */

    // Close the log fd since the child has inherited it
    try {
      fs.closeSync(logFd);
    } catch {
      // ignore
    }

    return new HegelSession(connection, control);
  }
}

function hegelCommand(): { command: string; args: string[] } {
  const override = process.env[HEGEL_SERVER_COMMAND_ENV];
  /* v8 ignore start */
  if (override) {
    return { command: override, args: [] };
  }
  /* v8 ignore stop */

  // Default: use uv tool run
  return {
    command: findUv(),
    args: ["tool", "run", "--from", `hegel-core==${HEGEL_SERVER_VERSION}`, "hegel"],
  };
}
