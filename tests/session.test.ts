import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HegelSession, hegel, runHegelTest } from "hegel";
import { _findHegeld } from "../src/session.js";
import { generateFromSchema, _testContextStorage } from "../src/runner.js";

// ---------------------------------------------------------------------------
// Hoisted mocks for ESM modules
// ---------------------------------------------------------------------------

// In Vitest ESM mode, vi.spyOn on frozen namespace objects doesn't work.
// We use vi.mock() to replace the modules, then vi.mocked() to configure per-test.

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
    mkdtempSync: vi.fn(actual.mkdtempSync),
    rmSync: vi.fn(actual.rmSync),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
    execSync: vi.fn(actual.execSync),
  };
});

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof net>();
  return {
    ...actual,
    createConnection: vi.fn(actual.createConnection),
  };
});

// ---------------------------------------------------------------------------
// _findHegeld
// ---------------------------------------------------------------------------

describe("_findHegeld", () => {
  const origHegelCmd = process.env["HEGEL_CMD"];

  afterEach(() => {
    // Restore HEGEL_CMD
    if (origHegelCmd !== undefined) {
      process.env["HEGEL_CMD"] = origHegelCmd;
    } else {
      delete process.env["HEGEL_CMD"];
    }
    vi.mocked(fs.existsSync).mockRestore();
    vi.mocked(fs.readFileSync).mockRestore();
    vi.mocked(fs.writeFileSync).mockRestore();
    vi.mocked(fs.mkdirSync).mockRestore();
    vi.mocked(childProcess.execSync).mockRestore();
  });

  it("returns HEGEL_CMD when set", () => {
    process.env["HEGEL_CMD"] = "/usr/local/bin/my-hegel";
    const result = _findHegeld();
    expect(result).toBe("/usr/local/bin/my-hegel");
  });

  it("returns empty string HEGEL_CMD when set to empty", () => {
    process.env["HEGEL_CMD"] = "";
    const result = _findHegeld();
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// HegelSession._cleanup
// ---------------------------------------------------------------------------

describe("HegelSession._cleanup", () => {
  afterEach(() => {
    vi.mocked(fs.rmSync).mockRestore();
  });

  it("is a no-op when nothing is started", () => {
    const session = new HegelSession();
    expect(() => session._cleanup()).not.toThrow();
  });

  it("sets all fields to null after cleanup", () => {
    const session = new HegelSession();

    const mockConnection = { close: vi.fn(), live: true };
    const mockProcess = { kill: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._connection = mockConnection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._client = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._process = mockProcess;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._tempDir = "/tmp/fake-hegel-dir";

    vi.mocked(fs.rmSync).mockImplementation(() => {});

    session._cleanup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._connection).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._client).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._process).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._tempDir).toBeNull();
  });

  it("suppresses exceptions from all cleanup operations", () => {
    const session = new HegelSession();

    const mockConnection = {
      close: vi.fn().mockImplementation(() => {
        throw new Error("close failed");
      }),
      live: false,
    };
    const mockProcess = {
      kill: vi.fn().mockImplementation(() => {
        throw new Error("kill failed");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._connection = mockConnection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._client = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._process = mockProcess;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._tempDir = "/tmp/fake";

    vi.mocked(fs.rmSync).mockImplementation(() => {
      throw new Error("rm failed");
    });

    expect(() => session._cleanup()).not.toThrow();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._connection).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._process).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._tempDir).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HegelSession._hasWorkingClient (branch coverage for dead connection)
// ---------------------------------------------------------------------------

describe("HegelSession._hasWorkingClient", () => {
  it("returns false when connection is live=false even with client set", () => {
    const session = new HegelSession();
    const mockConnection = { close: vi.fn(), live: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._client = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._connection = mockConnection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._hasWorkingClient()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HegelSession._cleanup
// ---------------------------------------------------------------------------

describe("HegelSession._cleanup", () => {
  it("cleans up connection, process, and tempDir", () => {
    const session = new HegelSession();

    const mockConnection = { close: vi.fn(), live: true };
    const mockProcess = { kill: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._connection = mockConnection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._client = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._process = mockProcess;

    vi.mocked(fs.rmSync).mockImplementation(() => {});

    session._cleanup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._connection).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._client).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._process).toBeNull();
  });

  afterEach(() => {
    vi.mocked(fs.rmSync).mockRestore();
  });
});

// ---------------------------------------------------------------------------
// HegelSession timeout kill
// ---------------------------------------------------------------------------

describe("HegelSession timeout", () => {
  const origHegelCmd = process.env["HEGEL_CMD"];

  beforeEach(() => {
    vi.useFakeTimers();
    // Set HEGEL_CMD so _findHegeld() skips ensureHegelInstalled()
    process.env["HEGEL_CMD"] = "/usr/bin/false";
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore HEGEL_CMD
    if (origHegelCmd !== undefined) {
      process.env["HEGEL_CMD"] = origHegelCmd;
    } else {
      delete process.env["HEGEL_CMD"];
    }
    vi.mocked(fs.existsSync).mockRestore();
    vi.mocked(fs.mkdtempSync).mockRestore();
    vi.mocked(fs.rmSync).mockRestore();
    vi.mocked(childProcess.spawn).mockRestore();
    vi.mocked(net.createConnection).mockRestore();
  });

  it("kills process and throws when socket never appears", async () => {
    const mockProcess = {
      kill: vi.fn(),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 99999,
    };
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockProcess as unknown as childProcess.ChildProcess,
    );
    vi.mocked(fs.existsSync).mockReturnValue(false); // socket never appears
    vi.mocked(fs.mkdtempSync).mockReturnValue("/tmp/hegel-fake");
    vi.mocked(fs.rmSync).mockImplementation(() => {});

    const session = new HegelSession();
    // Attach rejection handler immediately to avoid "unhandled rejection" warning
    const startPromise = session._start();
    const expectedRejection = expect(startPromise).rejects.toThrow("Timeout");

    // Advance fake time past 50 * 100ms = 5000ms
    await vi.advanceTimersByTimeAsync(6000);

    await expectedRejection;
    expect(mockProcess.kill).toHaveBeenCalled();
  });

  it("kills process and throws when socket exists but connection always refused", async () => {
    const mockProcess = {
      kill: vi.fn(),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 99998,
    };
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockProcess as unknown as childProcess.ChildProcess,
    );
    vi.mocked(fs.existsSync).mockReturnValue(true); // socket appears immediately
    vi.mocked(fs.mkdtempSync).mockReturnValue("/tmp/hegel-fake");
    vi.mocked(fs.rmSync).mockImplementation(() => {});

    // Intercept net.createConnection to always reject
    vi.mocked(net.createConnection).mockImplementation((..._args: unknown[]) => {
      const sock = new EventEmitter() as net.Socket;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sock as any).destroy = () => {};
      setTimeout(() => sock.emit("error", new Error("ECONNREFUSED")), 0);
      return sock;
    });

    const session = new HegelSession();
    // Attach rejection handler immediately to avoid "unhandled rejection" warning
    const startPromise = session._start();
    const expectedRejection = expect(startPromise).rejects.toThrow("Timeout");

    // Advance time past 50 * 100ms
    await vi.advanceTimersByTimeAsync(6000);

    await expectedRejection;
    expect(mockProcess.kill).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HegelSession concurrent start (promise dedup)
// ---------------------------------------------------------------------------

describe("HegelSession concurrent _start", () => {
  it("second concurrent call waits for the first, then sees working client", async () => {
    const session = new HegelSession();
    try {
      // Call _start twice "concurrently" (before either awaits)
      const p1 = session._start();
      const p2 = session._start();
      await Promise.all([p1, p2]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((session as any)._client).not.toBeNull();
    } finally {
      session._cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// HegelSession real integration
// ---------------------------------------------------------------------------

describe("HegelSession integration", () => {
  it("starts a hegel process and connects", async () => {
    const session = new HegelSession();
    try {
      await session._start();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((session as any)._client).not.toBeNull();
      // Second call is idempotent
      await session._start();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((session as any)._client).not.toBeNull();
    } finally {
      session._cleanup();
    }
  });

  it("skips registering exit handler when _cleanupRegistered is already true", async () => {
    // Pre-set _cleanupRegistered=true so _doStart skips the process.on("exit") call.
    const session = new HegelSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._cleanupRegistered = true;
    try {
      await session._start();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((session as any)._client).not.toBeNull();
      // _cleanupRegistered stays true (we set it, doStart skipped re-setting)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((session as any)._cleanupRegistered).toBe(true);
    } finally {
      session._cleanup();
    }
  });

  it("runs a test via runTest", async () => {
    const session = new HegelSession();
    try {
      await session.runTest(async () => {
        const x = (await generateFromSchema(
          {
            type: "integer",
            min_value: 0,
            max_value: 10,
          },
          _testContextStorage.getStore()!,
        )) as number;
        if (x < 0 || x > 10) throw new Error("out of range");
      }, 5);
    } finally {
      session._cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// runHegelTest (global API)
// ---------------------------------------------------------------------------

describe("runHegelTest", () => {
  it("runs a simple passing test", async () => {
    await runHegelTest(() => {});
  });

  it("runs a named function", async () => {
    async function myNamedTest() {
      await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
    }
    await runHegelTest(myNamedTest);
  });
});

// ---------------------------------------------------------------------------
// hegel decorator
// ---------------------------------------------------------------------------

describe("hegel decorator", () => {
  it("wraps a function that passes", async () => {
    const wrapped = hegel()(async () => {
      await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
    });
    await wrapped();
  });

  it("wraps a function and uses test_cases option", async () => {
    const wrapped = hegel({ testCases: 5 })(async () => {
      await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
    });
    await wrapped();
  });

  it("falls back to 'test' wrapper name when function has no name", async () => {
    const anonFn = (() => {}) as unknown as () => void;
    Object.defineProperty(anonFn, "name", { value: undefined });
    const wrapped = hegel({ testCases: 1 })(anonFn);
    expect(wrapped.name).toBe("test");
    await wrapped();
  });
});
