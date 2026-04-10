import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
  };
});

// ---------------------------------------------------------------------------
// _findHegeld
// ---------------------------------------------------------------------------

describe("_findHegeld", () => {
  afterEach(() => {
    vi.mocked(fs.existsSync).mockRestore();
  });

  it("returns .venv/bin/hegel when it exists in cwd", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes(".venv") && String(p).endsWith("hegel");
    });
    const result = _findHegeld();
    expect(result).toContain("hegel");
    expect(result).toContain(".venv");
  });

  it("returns hegel from PATH when .venv not found", () => {
    const origPath = process.env["PATH"];
    process.env["PATH"] =
      "/usr/local/bin" + (process.platform === "win32" ? ";" : ":") + "/usr/bin";
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      // .venv/bin/hegel does NOT exist, but /usr/local/bin/hegel does
      return !s.includes(".venv") && s.endsWith("hegel");
    });
    const result = _findHegeld();
    expect(result).toContain("hegel");
    expect(result).not.toContain(".venv");
    process.env["PATH"] = origPath;
  });

  it("falls back to python3 -m hegel when not found anywhere", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = _findHegeld();
    expect(result).toBe("python3 -m hegel");
  });

  it("handles undefined PATH (falls back to python3 -m hegel)", () => {
    const origPath = process.env["PATH"];
    delete process.env["PATH"];
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = _findHegeld();
    expect(result).toBe("python3 -m hegel");
    process.env["PATH"] = origPath;
  });

  it("skips empty PATH entries", () => {
    const origPath = process.env["PATH"];
    // PATH with a leading colon produces an empty entry
    process.env["PATH"] = ":/usr/local/bin";
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const s = String(p);
      return !s.includes(".venv") && s.endsWith("hegel");
    });
    const result = _findHegeld();
    expect(result).toContain("hegel");
    process.env["PATH"] = origPath;
  });
});

// ---------------------------------------------------------------------------
// HegelSession._cleanup
// ---------------------------------------------------------------------------

describe("HegelSession._cleanup", () => {
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

    session._cleanup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._connection).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._client).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._process).toBeNull();
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

    expect(() => session._cleanup()).not.toThrow();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._connection).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._process).toBeNull();
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
  it("cleans up connection and process", () => {
    const session = new HegelSession();

    const mockConnection = { close: vi.fn(), live: true };
    const mockProcess = { kill: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._connection = mockConnection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._client = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any)._process = mockProcess;

    session._cleanup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._connection).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._client).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((session as any)._process).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HegelSession startup failure
// ---------------------------------------------------------------------------

describe("HegelSession startup failure", () => {
  afterEach(() => {
    vi.mocked(childProcess.spawn).mockRestore();
  });

  it("rejects when hegel process exits immediately", async () => {
    // Mock spawn to return a process whose stdout ends immediately,
    // causing the Connection handshake to fail.
    const { PassThrough } = await import("node:stream");
    const fakeStdout = new PassThrough();
    const fakeStdin = new PassThrough();
    const fakeStderr = new PassThrough();

    vi.mocked(childProcess.spawn).mockReturnValue({
      stdout: fakeStdout,
      stdin: fakeStdin,
      stderr: fakeStderr,
      kill: vi.fn(),
      pid: 99999,
    } as unknown as childProcess.ChildProcess);

    // End stdout immediately to simulate process exit
    fakeStdout.end();

    const session = new HegelSession();
    await expect(session._start()).rejects.toThrow();
    session._cleanup();
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
