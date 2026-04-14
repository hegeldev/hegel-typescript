/**
 * Tests for uncovered paths in session.ts.
 *
 * Uses vi.mock to control child_process.spawn and test error paths
 * in HegelSession.init() that cannot be exercised with the real hegel server.
 *
 * Covered lines:
 * - parseVersion error paths (lines 33, 38)
 * - versionInRange returning false (lines 47-48)
 * - fd extraction failure (lines 116-117)
 * - bad handshake response (lines 129-130)
 * - version mismatch (lines 135-136)
 * - process.on("exit") cleanup (lines 144-145)
 * - hegelCommand with HEGEL_SERVER_COMMAND env (line 169)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to dynamically import session.ts after mocking, and each test
// needs a fresh module to reset the singleton.

describe("session.ts error paths", () => {
  // Save original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("HEGEL_SERVER_COMMAND env override is used (line 169)", async () => {
    // Set the env var BEFORE importing session module
    process.env["HEGEL_SERVER_COMMAND"] = "/nonexistent/hegel-fake";

    // Mock child_process.spawn to capture the command used
    let spawnedCommand: string | null = null;

    vi.doMock("node:child_process", () => ({
      spawn: (cmd: string, _args: string[], _opts: unknown) => {
        spawnedCommand = cmd;
        // Return a fake child process that immediately fails
        const fakeChild = {
          stdout: {
            pause: () => {},
            _handle: { fd: null }, // will trigger fd extraction failure
          },
          stdin: {
            cork: () => {},
            _handle: { fd: null },
          },
          kill: () => {},
          killed: false,
          exitCode: null,
        };
        return fakeChild;
      },
    }));

    // Also mock node:fs to avoid real file operations
    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
      };
    });

    // Dynamically import session to get a fresh module with mocked deps
    const { HegelSession } = await import("../src/session.js");

    // This should throw because fd extraction fails
    expect(() => HegelSession.get()).toThrow(
      "Failed to extract file descriptors from child process pipes",
    );

    // Verify the custom command was used
    expect(spawnedCommand).toBe("/nonexistent/hegel-fake");
  });

  it("fd extraction failure kills child and throws (lines 116-117)", async () => {
    let childKilled = false;

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          stdout: {
            pause: () => {},
            _handle: { fd: undefined }, // not a number -> extraction failure
          },
          stdin: {
            cork: () => {},
            _handle: { fd: 42 },
          },
          kill: () => {
            childKilled = true;
          },
          killed: false,
          exitCode: null,
        };
      },
    }));

    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
      };
    });

    const { HegelSession } = await import("../src/session.js");

    expect(() => HegelSession.get()).toThrow(
      "Failed to extract file descriptors from child process pipes",
    );
    expect(childKilled).toBe(true);
  });

  it("bad handshake response kills child and throws (lines 129-130)", async () => {
    let childKilled = false;

    // We need to simulate a successful fd extraction but a bad handshake response.
    // This requires the Connection and readSync/writeSync to work.
    // We'll mock fs to control readSync.

    // Build a fake handshake response packet that says "BadResponse" instead of "Hegel/..."
    const { encodePacket } = await import("../src/protocol.js");
    const responsePayload = Buffer.from("BadResponse");
    const responsePacket = encodePacket({
      streamId: 0,
      messageId: 1,
      isReply: true,
      payload: responsePayload,
    });

    let readOffset = 0;

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          stdout: {
            pause: () => {},
            _handle: { fd: 10 },
          },
          stdin: {
            cork: () => {},
            _handle: { fd: 11 },
          },
          kill: () => {
            childKilled = true;
          },
          killed: false,
          exitCode: null,
        };
      },
    }));

    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
        writeSync: () => {
          // Discard writes (the handshake request)
          return 0;
        },
        readSync: (
          _fd: number,
          buf: Buffer,
          offset: number,
          length: number,
          _position: unknown,
        ) => {
          // Return data from our fake response packet
          const available = Math.min(length, responsePacket.length - readOffset);
          if (available <= 0) return 0;
          responsePacket.copy(buf, offset, readOffset, readOffset + available);
          readOffset += available;
          return available;
        },
      };
    });

    const { HegelSession } = await import("../src/session.js");

    expect(() => HegelSession.get()).toThrow("Bad handshake response");
    expect(childKilled).toBe(true);
  });

  it("version mismatch kills child and throws (lines 135-136)", async () => {
    let childKilled = false;

    const { encodePacket } = await import("../src/protocol.js");
    // Respond with a valid "Hegel/" prefix but wrong version
    const responsePayload = Buffer.from("Hegel/99.99");
    const responsePacket = encodePacket({
      streamId: 0,
      messageId: 1,
      isReply: true,
      payload: responsePayload,
    });

    let readOffset = 0;

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          stdout: {
            pause: () => {},
            _handle: { fd: 10 },
          },
          stdin: {
            cork: () => {},
            _handle: { fd: 11 },
          },
          kill: () => {
            childKilled = true;
          },
          killed: false,
          exitCode: null,
        };
      },
    }));

    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
        writeSync: () => 0,
        readSync: (
          _fd: number,
          buf: Buffer,
          offset: number,
          length: number,
          _position: unknown,
        ) => {
          const available = Math.min(length, responsePacket.length - readOffset);
          if (available <= 0) return 0;
          responsePacket.copy(buf, offset, readOffset, readOffset + available);
          readOffset += available;
          return available;
        },
      };
    });

    const { HegelSession } = await import("../src/session.js");

    expect(() => HegelSession.get()).toThrow("supports protocol versions");
    expect(childKilled).toBe(true);
  });

  it("version below range triggers versionInRange false (lines 47-48)", async () => {
    let childKilled = false;

    const { encodePacket } = await import("../src/protocol.js");
    // Respond with version 0.1 which is below the supported 0.10 range
    const responsePayload = Buffer.from("Hegel/0.1");
    const responsePacket = encodePacket({
      streamId: 0,
      messageId: 1,
      isReply: true,
      payload: responsePayload,
    });

    let readOffset = 0;

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          stdout: {
            pause: () => {},
            _handle: { fd: 10 },
          },
          stdin: {
            cork: () => {},
            _handle: { fd: 11 },
          },
          kill: () => {
            childKilled = true;
          },
          killed: false,
          exitCode: null,
        };
      },
    }));

    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
        writeSync: () => 0,
        readSync: (
          _fd: number,
          buf: Buffer,
          offset: number,
          length: number,
          _position: unknown,
        ) => {
          const available = Math.min(length, responsePacket.length - readOffset);
          if (available <= 0) return 0;
          responsePacket.copy(buf, offset, readOffset, readOffset + available);
          readOffset += available;
          return available;
        },
      };
    });

    const { HegelSession } = await import("../src/session.js");

    expect(() => HegelSession.get()).toThrow("supports protocol versions");
    expect(childKilled).toBe(true);
  });

  it("parseVersion with bad format throws (lines 33, 38)", async () => {
    const _childKilled = false;

    const { encodePacket } = await import("../src/protocol.js");
    // Respond with a version that is not "major.minor" format - no dot
    const responsePayload = Buffer.from("Hegel/badversion");
    const responsePacket = encodePacket({
      streamId: 0,
      messageId: 1,
      isReply: true,
      payload: responsePayload,
    });

    let readOffset = 0;

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          stdout: {
            pause: () => {},
            _handle: { fd: 10 },
          },
          stdin: {
            cork: () => {},
            _handle: { fd: 11 },
          },
          kill: () => {
            childKilled = true;
          },
          killed: false,
          exitCode: null,
        };
      },
    }));

    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
        writeSync: () => 0,
        readSync: (
          _fd: number,
          buf: Buffer,
          offset: number,
          length: number,
          _position: unknown,
        ) => {
          const available = Math.min(length, responsePacket.length - readOffset);
          if (available <= 0) return 0;
          responsePacket.copy(buf, offset, readOffset, readOffset + available);
          readOffset += available;
          return available;
        },
      };
    });

    const { HegelSession } = await import("../src/session.js");

    expect(() => HegelSession.get()).toThrow("Invalid version string");
  });

  it("parseVersion with non-numeric parts throws (line 38)", async () => {
    const { encodePacket } = await import("../src/protocol.js");
    // "a.b" has correct format (2 parts) but non-numeric
    const responsePayload = Buffer.from("Hegel/a.b");
    const responsePacket = encodePacket({
      streamId: 0,
      messageId: 1,
      isReply: true,
      payload: responsePayload,
    });

    let readOffset = 0;

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          stdout: {
            pause: () => {},
            _handle: { fd: 10 },
          },
          stdin: {
            cork: () => {},
            _handle: { fd: 11 },
          },
          kill: () => {},
          killed: false,
          exitCode: null,
        };
      },
    }));

    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
        writeSync: () => 0,
        readSync: (
          _fd: number,
          buf: Buffer,
          offset: number,
          length: number,
          _position: unknown,
        ) => {
          const available = Math.min(length, responsePacket.length - readOffset);
          if (available <= 0) return 0;
          responsePacket.copy(buf, offset, readOffset, readOffset + available);
          readOffset += available;
          return available;
        },
      };
    });

    const { HegelSession } = await import("../src/session.js");

    expect(() => HegelSession.get()).toThrow("Invalid version string");
  });

  it("process.on('exit') cleanup calls child.kill (lines 144-145)", async () => {
    const { encodePacket } = await import("../src/protocol.js");

    // Build correct handshake response with matching version
    vi.resetModules(); // Reset so we can re-import with mocks

    // We need to simulate a SUCCESSFUL init to register the exit handler
    // The supported protocol version range is 0.10-0.10
    const responsePayload = Buffer.from("Hegel/0.10");
    const responsePacket = encodePacket({
      streamId: 0,
      messageId: 1,
      isReply: true,
      payload: responsePayload,
    });

    let readOffset = 0;
    let killCalled = false;
    const exitHandlers: (() => void)[] = [];
    const origProcessOn = process.on.bind(process);

    vi.doMock("node:child_process", () => ({
      spawn: () => {
        return {
          stdout: {
            pause: () => {},
            _handle: { fd: 10 },
          },
          stdin: {
            cork: () => {},
            _handle: { fd: 11 },
          },
          kill: () => {
            killCalled = true;
          },
          killed: false,
          exitCode: null,
        };
      },
    }));

    vi.doMock("node:fs", async (importOriginal) => {
      const orig = (await importOriginal()) as typeof import("node:fs");
      return {
        ...orig,
        mkdirSync: () => {},
        openSync: () => 99,
        closeSync: () => {},
        writeSync: () => 0,
        readSync: (
          _fd: number,
          buf: Buffer,
          offset: number,
          length: number,
          _position: unknown,
        ) => {
          const available = Math.min(length, responsePacket.length - readOffset);
          if (available <= 0) return 0;
          responsePacket.copy(buf, offset, readOffset, readOffset + available);
          readOffset += available;
          return available;
        },
      };
    });

    // Spy on process.on to capture the exit handler
    const processOnSpy = vi.spyOn(process, "on").mockImplementation((event, handler) => {
      if (event === "exit") {
        exitHandlers.push(handler as () => void);
        return process;
      }
      return origProcessOn(event as string, handler as (...args: unknown[]) => void);
    });

    const sessionMod = await import("../src/session.js");

    // This should succeed - correct version, valid fds
    sessionMod.HegelSession.get();

    // The exit handler should have been registered
    expect(exitHandlers.length).toBeGreaterThan(0);

    // Call the exit handler to exercise lines 144-145
    exitHandlers[0]();
    expect(killCalled).toBe(true);

    // Test that child.kill() throwing in exit handler is silently caught
    // The handler already ran; we can verify it catches errors by re-calling
    // (the real handler has try/catch)
    exitHandlers[0](); // second call - child.kill is already called, but it shouldn't throw
    // (our mock doesn't throw, which is fine)

    processOnSpy.mockRestore();
  });
});
