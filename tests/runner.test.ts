/**
 * Tests for the Client, runner helpers, and test lifecycle.
 *
 * Most tests use the real hegel binary via runHegelTest or a fresh HegelSession.
 * Error injection tests use HEGEL_PROTOCOL_TEST_MODE with a fresh session each time.
 * For unrecognised-event handling we use a manual socket-pair server (no mock server).
 */

import * as net from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  AssertionError,
  AssumeRejected,
  ConnectionError,
  DataExhausted,
  RuntimeError,
  BasicGenerator,
  HegelSession,
  runHegelTest,
  assume,
  draw,
  note,
  target,
} from "hegel";
import { Channel, Connection, ConnectionState, RequestError } from "../src/connection.js";
import {
  Client,
  Labels,
  _getChannel,
  _testContextStorage,
  extractOrigin,
  generateFromSchema,
  startSpan,
  stopSpan,
} from "../src/runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Raw handshake responder: reads the handshake request from the control channel
 * and replies with "Hegel/0.3". Sets the connection to CLIENT state with a high
 * channel ID base to avoid collisions with the actual client side.
 */
async function rawHandshakeResponder(conn: Connection): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (conn as any)._connectionState = ConnectionState.CLIENT;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (conn as any)._nextChannelId = 1000;
  const [msgId] = await conn.controlChannel.receiveRequestRaw();
  await conn.controlChannel.sendResponseRaw(msgId, Buffer.from("Hegel/0.3"));
}

/** Create a connected TCP socket pair for in-process tests. */
function socketPair(): Promise<[net.Socket, net.Socket]> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((serverSocket) => {
      server.close();
      resolve([serverSocket, clientSocket]);
    });
    server.on("error", reject);
    let clientSocket: net.Socket;
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      clientSocket = net.createConnection(addr.port, "127.0.0.1");
      clientSocket.on("error", reject);
    });
  });
}

/**
 * Run a test with HEGEL_PROTOCOL_TEST_MODE set to `mode` using a fresh session.
 * Cleans up the session afterward.
 */
async function withTestMode(
  mode: string,
  fn: (session: HegelSession) => Promise<void>,
): Promise<void> {
  const origMode = process.env["HEGEL_PROTOCOL_TEST_MODE"];
  process.env["HEGEL_PROTOCOL_TEST_MODE"] = mode;
  const session = new HegelSession();
  try {
    await fn(session);
  } finally {
    session._cleanup();
    if (origMode !== undefined) {
      process.env["HEGEL_PROTOCOL_TEST_MODE"] = origMode;
    } else {
      delete process.env["HEGEL_PROTOCOL_TEST_MODE"];
    }
  }
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("AssumeRejected", () => {
  it("has correct name", () => {
    const e = new AssumeRejected();
    expect(e.name).toBe("AssumeRejected");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("DataExhausted", () => {
  it("has correct name", () => {
    const e = new DataExhausted();
    expect(e.name).toBe("DataExhausted");
    expect(e).toBeInstanceOf(Error);
  });

  it("accepts custom message", () => {
    const e = new DataExhausted("custom");
    expect(e.message).toBe("custom");
  });
});

describe("RuntimeError", () => {
  it("has correct name", () => {
    const e = new RuntimeError("msg");
    expect(e.name).toBe("RuntimeError");
    expect(e.message).toBe("msg");
  });
});

describe("ConnectionError", () => {
  it("has correct name", () => {
    const e = new ConnectionError("msg");
    expect(e.name).toBe("ConnectionError");
  });
});

describe("AssertionError", () => {
  it("has correct name", () => {
    const e = new AssertionError("msg");
    expect(e.name).toBe("AssertionError");
    expect(e.message).toBe("msg");
  });
});

// ---------------------------------------------------------------------------
// Labels constants
// ---------------------------------------------------------------------------

describe("Labels", () => {
  it("has correct values", () => {
    expect(Labels.LIST).toBe(1);
    expect(Labels.LIST_ELEMENT).toBe(2);
    expect(Labels.SET).toBe(3);
    expect(Labels.SET_ELEMENT).toBe(4);
    expect(Labels.MAP).toBe(5);
    expect(Labels.MAP_ENTRY).toBe(6);
    expect(Labels.TUPLE).toBe(7);
    expect(Labels.ONE_OF).toBe(8);
    expect(Labels.OPTIONAL).toBe(9);
    expect(Labels.FIXED_DICT).toBe(10);
    expect(Labels.FLAT_MAP).toBe(11);
    expect(Labels.FILTER).toBe(12);
    expect(Labels.MAPPED).toBe(13);
    expect(Labels.SAMPLED_FROM).toBe(14);
    expect(Labels.ENUM_VARIANT).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// extractOrigin
// ---------------------------------------------------------------------------

describe("extractOrigin", () => {
  it("extracts file and line from a real stack trace", () => {
    let err!: Error;
    try {
      throw new Error("test");
    } catch (e) {
      err = e as Error;
    }
    const origin = extractOrigin(err);
    expect(origin).toContain("Error");
    expect(origin).toMatch(/runner\.test\.(ts|js):\d+/);
  });

  it("returns :0 when stack is missing", () => {
    const err = new Error("no stack");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).stack = undefined;
    const origin = extractOrigin(err);
    expect(origin).toBe("Error at :0");
  });

  it("returns :0 when stack has no parseable frames", () => {
    const err = new Error("weird");
    err.stack = "Error: weird\n  no frames here";
    const origin = extractOrigin(err);
    expect(origin).toBe("Error at :0");
  });

  it("handles plain (no-paren) stack frame format", () => {
    const err = new Error("plain");
    err.stack = "Error: plain\n    at /some/file.js:42:10";
    const origin = extractOrigin(err);
    expect(origin).toBe("Error at /some/file.js:42");
  });

  it("uses 'Error' when constructor.name is undefined", () => {
    // Create an object with no constructor.name to exercise the `?? "Error"` fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = { constructor: undefined, stack: undefined } as any as Error;
    const origin = extractOrigin(err);
    expect(origin).toBe("Error at :0");
  });
});

// ---------------------------------------------------------------------------
// _getChannel
// ---------------------------------------------------------------------------

describe("_getChannel", () => {
  it("throws outside a test context (store undefined)", () => {
    // Outside any run() call, store is undefined
    expect(() => _getChannel()).toThrow("Not in a test context");
  });

  it("throws when context is null", async () => {
    await _testContextStorage.run(null, () => {
      expect(() => _getChannel()).toThrow("Not in a test context");
      return Promise.resolve();
    });
  });

  it("returns channel when inside context", async () => {
    const fakeChannel = {} as Channel;
    const data = { channel: fakeChannel, isFinal: false, testAborted: false };
    await _testContextStorage.run(data, async () => {
      const ch = _getChannel();
      expect(ch).toBe(fakeChannel);
    });
  });
});

// ---------------------------------------------------------------------------
// assume
// ---------------------------------------------------------------------------

describe("assume", () => {
  it("throws RuntimeError outside test context", () => {
    expect(() => assume(true)).toThrow("assume() cannot be called outside of a Hegel test");
  });

  it("true is a no-op inside context", async () => {
    const fakeChannel = {} as Channel;
    const data = { channel: fakeChannel, isFinal: false, testAborted: false };
    await _testContextStorage.run(data, async () => {
      expect(() => assume(true)).not.toThrow();
    });
  });

  it("false throws AssumeRejected inside context", async () => {
    const fakeChannel = {} as Channel;
    const data = { channel: fakeChannel, isFinal: false, testAborted: false };
    await _testContextStorage.run(data, async () => {
      expect(() => assume(false)).toThrow(AssumeRejected);
    });
  });
});

// ---------------------------------------------------------------------------
// note
// ---------------------------------------------------------------------------

describe("note", () => {
  it("throws RuntimeError outside test context", () => {
    expect(() => note("msg")).toThrow("note() cannot be called outside of a Hegel test");
  });

  it("throws RuntimeError when context is null", async () => {
    await _testContextStorage.run(null, async () => {
      expect(() => note("msg")).toThrow("note() cannot be called outside of a Hegel test");
    });
  });

  it("is silent when isFinal=false", async () => {
    const fakeChannel = {} as Channel;
    const data = { channel: fakeChannel, isFinal: false, testAborted: false };
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await _testContextStorage.run(data, async () => {
      note("should not print");
      expect(spy).not.toHaveBeenCalled();
    });
    spy.mockRestore();
  });

  it("prints when isFinal=true", async () => {
    const fakeChannel = {} as Channel;
    const data = { channel: fakeChannel, isFinal: true, testAborted: false };
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await _testContextStorage.run(data, async () => {
      note("test message");
      expect(spy).toHaveBeenCalledWith("test message\n");
    });
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// target
// ---------------------------------------------------------------------------

describe("target", () => {
  it("throws RuntimeError outside test context", async () => {
    await expect(target(1.0)).rejects.toThrow("target() cannot be called outside of a Hegel test");
  });
});

// ---------------------------------------------------------------------------
// startSpan / stopSpan (when testAborted)
// ---------------------------------------------------------------------------

describe("startSpan / stopSpan when testAborted", () => {
  it("are no-ops when testAborted=true", async () => {
    const fakeChannel = { request: vi.fn() } as unknown as Channel;
    const data = { channel: fakeChannel, isFinal: false, testAborted: true };
    await startSpan(1, data);
    await stopSpan({}, data);
    expect(fakeChannel.request).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Client.create - version check
// ---------------------------------------------------------------------------

describe("Client.create", () => {
  it("rejects unsupported protocol version", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    // Manually perform a fake handshake with a bad version
    const serverTask = (async () => {
      // Wait for client's handshake request, reply with bad version
      const [msgId, _payload] = await serverConn.controlChannel.receiveRequestRaw();
      const buf = Buffer.from("Hegel/99.0");
      await serverConn.controlChannel.sendResponseRaw(msgId, buf);
    })();

    const clientTask = Client.create(clientConn);

    await expect(clientTask).rejects.toThrow("hegel supports protocol versions");
    await serverTask;
    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Integration tests via real hegel binary
// ---------------------------------------------------------------------------

describe("runHegelTest integration", () => {
  it("passes a simple test with no assertions", async () => {
    await runHegelTest(() => {
      // Nothing - always valid
    });
  });

  it("passes when all test cases are INVALID (assume false)", async () => {
    await runHegelTest(async () => {
      // Generate something so the server knows we're running
      await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
      assume(false);
    });
  });

  it("re-raises original exception for a single interesting failure", async () => {
    await expect(
      runHegelTest(async () => {
        const x = (await generateFromSchema(
          {
            type: "integer",
            min_value: 0,
            max_value: 100,
          },
          _testContextStorage.getStore()!,
        )) as number;
        if (x >= 50) throw new Error("x is too large");
      }),
    ).rejects.toThrow("x is too large");
  });

  it("raises AggregateError for multiple distinct failures (manual server)", async () => {
    // Use a manual server that reports 2 interesting cases so we can test AggregateError
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    const serverTask = (async () => {
      await rawHandshakeResponder(serverConn);
      const control = serverConn.controlChannel;
      const [msgId, message] = await control.receiveRequest();
      const msg = message as Record<string, unknown>;
      const testChannelId = msg["channel_id"] as number;
      const testChannel = serverConn.connectChannel(testChannelId, { role: "Test" });
      await control.sendResponseValue(msgId, true);

      // Send test_done with 2 interesting cases
      const tdReq = await testChannel.sendRequest({
        event: "test_done",
        results: {
          passed: false,
          test_cases: 0,
          valid_test_cases: 0,
          invalid_test_cases: 0,
          interesting_test_cases: 2,
        },
      });
      await testChannel.receiveResponseRaw(tdReq);

      // Send 2 final test cases
      for (let i = 0; i < 2; i++) {
        const dc = serverConn.newChannel({ role: `FinalData${i}` });
        const req = await testChannel.sendRequest({ event: "test_case", channel_id: dc.channelId });
        await testChannel.receiveResponseRaw(req);
        const [mcId] = await dc.receiveRequest({ timeoutMs: 5000 });
        await dc.sendResponseValue(mcId, null);
        dc.close();
      }
    })();

    await clientConn.sendHandshake();
    const client = new Client(clientConn);

    // Each final run throws — first an Error, second a non-Error string
    let callCount = 0;
    client._runTestCase = async (
      ch: Channel,
      _fn: () => void | Promise<void>,
      isFinal: boolean,
    ) => {
      if (isFinal) {
        ch.sendRequest({ command: "mark_complete", status: "INTERESTING", origin: null }).catch(
          () => {},
        );
        ch.close();
        if (callCount++ === 0) {
          throw new Error("failure 0");
        }
        throw "non-error failure" as unknown; // covers `e instanceof Error ? e : new Error(String(e))` false branch
      }
      ch.sendRequest({ command: "mark_complete", status: "VALID", origin: null }).catch(() => {});
      ch.close();
    };

    await expect(client.runTest(() => {}, { testCases: 1 })).rejects.toThrow(AggregateError);

    await serverTask;
    clientConn.close();
    serverConn.close();
  });

  it("assume(true) is a no-op in a live test", async () => {
    await runHegelTest(() => {
      assume(true);
    });
  });

  it("target() completes without error", async () => {
    await runHegelTest(async () => {
      const b = (await generateFromSchema(
        { type: "boolean" },
        _testContextStorage.getStore()!,
      )) as boolean;
      await target(b ? 1.0 : 0.0, "bool_score");
    });
  });

  it("note() on non-final run is silent", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await runHegelTest(async () => {
        await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
        note("should not print");
      });
    } finally {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("note() on final run prints to stderr", async () => {
    const messages: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      messages.push(String(s));
      return true;
    });
    await expect(
      runHegelTest(async () => {
        const x = (await generateFromSchema(
          {
            type: "integer",
            min_value: 0,
            max_value: 100,
          },
          _testContextStorage.getStore()!,
        )) as number;
        note("final note message");
        if (x >= 50) throw new Error("fail");
      }),
    ).rejects.toThrow();
    spy.mockRestore();
    // The note should have been printed during the final replay
    expect(messages.some((m) => m.includes("final note message"))).toBe(true);
  });

  it("non-StopTest RequestError is re-raised to test body", async () => {
    let caughtError: unknown;
    await runHegelTest(
      async () => {
        try {
          await generateFromSchema(
            { type: "completely_invalid_schema_type_xyz" },
            _testContextStorage.getStore()!,
          );
        } catch (e) {
          caughtError = e;
          // Don't re-throw so the test "passes" (we just check it was a RequestError)
        }
      },
      { testCases: 1 },
    );
    expect(caughtError).toBeInstanceOf(RequestError);
  });

  it("ConnectionError propagates out of test body", async () => {
    await expect(
      runHegelTest(
        () => {
          throw new ConnectionError("connection lost");
        },
        { testCases: 1 },
      ),
    ).rejects.toThrow("connection lost");
  });

  it("non-Error thrown value is wrapped in Error for origin extraction", async () => {
    // Throwing a non-Error value (e.g. a string) exercises the
    // `e instanceof Error ? e : new Error(String(e))` branch in _runTestCase.
    await expect(
      runHegelTest(
        () => {
          throw "not an error object" as unknown;
        },
        { testCases: 1 },
      ),
    ).rejects.toBe("not an error object");
  });
});

// ---------------------------------------------------------------------------
// HEGEL_PROTOCOL_TEST_MODE error injection tests
// ---------------------------------------------------------------------------

describe("HEGEL_PROTOCOL_TEST_MODE tests", () => {
  it("stop_test_on_generate: completes without error", async () => {
    await withTestMode("stop_test_on_generate", async (session) => {
      await session.runTest(async () => {
        await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
      }, 5);
    });
  });

  it("stop_test_on_mark_complete: completes without error", async () => {
    await withTestMode("stop_test_on_mark_complete", async (session) => {
      await session.runTest(async () => {
        await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
      }, 5);
    });
  });

  it("error_response: RequestError is caught and marked INTERESTING (test completes)", async () => {
    // The error_response test mode sends RequestError on generate.
    // The SDK catches it, marks the test case INTERESTING, and sends mark_complete.
    // The test_server then sends test_done with interesting_test_cases=0,
    // so from the SDK's perspective the test "passed" (no interesting failures).
    await withTestMode("error_response", async (session) => {
      await session.runTest(async () => {
        await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
      }, 5);
    });
  });

  it("empty_test: completes gracefully with no test cases", async () => {
    await withTestMode("empty_test", async (session) => {
      await session.runTest(() => {}, 5);
    });
  });
});

// ---------------------------------------------------------------------------
// Nested test case raises RuntimeError
// ---------------------------------------------------------------------------

describe("nested test case raises", () => {
  it("raises RuntimeError when _runTestCase called while already in a test", async () => {
    // Set up a context as if we're already inside a test case
    const fakeChannel = {} as Channel;
    const data = { channel: fakeChannel, isFinal: false, testAborted: false };

    await _testContextStorage.run(data, async () => {
      // Create a Client with a manual socket pair (handshake needed for Client constructor)
      const [serverSock, clientSock] = await socketPair();
      const serverConn = new Connection(serverSock, { name: "Server" });
      const clientConn = new Connection(clientSock, { name: "Client" });

      // Do handshake in parallel
      await Promise.all([rawHandshakeResponder(serverConn), clientConn.sendHandshake()]);

      const client = new Client(clientConn);

      // _runTestCase should throw immediately because context is already set
      await expect(client._runTestCase(fakeChannel, () => {}, false)).rejects.toThrow(
        "Cannot nest test cases",
      );

      clientConn.close();
      serverConn.close();
    });
  });
});

// ---------------------------------------------------------------------------
// _runTestCase: mark_complete sendRequest failure (covers .catch(() => {}))
// ---------------------------------------------------------------------------

describe("_runTestCase mark_complete failure", () => {
  it("silently ignores sendRequest rejection in finally", async () => {
    // Build a fake channel whose sendRequest always rejects.
    // This exercises the `.catch(() => {})` handler at the end of _runTestCase.
    const fakeChannel = {
      sendRequest: () => Promise.reject(new Error("socket dead")),
      close: () => {},
    } as unknown as Channel;

    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });
    await Promise.all([rawHandshakeResponder(serverConn), clientConn.sendHandshake()]);
    const client = new Client(clientConn);

    // _runTestCase will try sendRequest(mark_complete) → rejects → .catch fires
    await client._runTestCase(fakeChannel, () => {}, false);

    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// Unrecognised event in runTest
// ---------------------------------------------------------------------------

describe("unrecognised event in runTest", () => {
  it("sends InvalidMessage error and continues to test_done", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    const serverTask = (async () => {
      await rawHandshakeResponder(serverConn);
      const control = serverConn.controlChannel;

      // Receive run_test command
      const [msgId, message] = await control.receiveRequest();
      const msg = message as Record<string, unknown>;
      const testChannelId = msg["channel_id"] as number;
      const testChannel = serverConn.connectChannel(testChannelId, { role: "Test" });
      await control.sendResponseValue(msgId, true);

      // Send a bogus event and read the error response
      const reqId = await testChannel.sendRequest({ event: "bogus_event" });
      await testChannel.receiveResponseRaw(reqId);

      // Send test_done
      await testChannel
        .request({
          event: "test_done",
          results: {
            passed: true,
            test_cases: 0,
            valid_test_cases: 0,
            invalid_test_cases: 0,
            interesting_test_cases: 0,
          },
        })
        .get();
    })();

    await clientConn.sendHandshake();
    const client = new Client(clientConn);
    // Call without testCases to exercise the `opts.testCases ?? 100` default
    await client.runTest(() => {});

    await serverTask;
    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// "Expected test case to fail" when final run passes (n_interesting=1 and >1)
// ---------------------------------------------------------------------------

describe("final test case passes unexpectedly", () => {
  it("raises AssertionError when single interesting test case passes in final run", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    const serverTask = (async () => {
      await rawHandshakeResponder(serverConn);
      const control = serverConn.controlChannel;
      const [msgId, message] = await control.receiveRequest();
      const msg = message as Record<string, unknown>;
      const testChannelId = msg["channel_id"] as number;
      const testChannel = serverConn.connectChannel(testChannelId, { role: "Test" });
      await control.sendResponseValue(msgId, true);

      // Send one test_case (exploration — will pass)
      const dataChannel = serverConn.newChannel({ role: "Data" });
      const req1 = await testChannel.sendRequest({
        event: "test_case",
        channel_id: dataChannel.channelId,
      });
      await testChannel.receiveResponseRaw(req1);
      // Wait for mark_complete from client (they'll send VALID since test passes)
      await dataChannel.receiveRequest({ timeoutMs: 5000 });
      await dataChannel.sendResponseValue(0, null);
      dataChannel.close();

      // Send test_done with 1 interesting case
      const req2 = await testChannel.sendRequest({
        event: "test_done",
        results: {
          passed: false,
          test_cases: 1,
          valid_test_cases: 0,
          invalid_test_cases: 0,
          interesting_test_cases: 1,
        },
      });
      await testChannel.receiveResponseRaw(req2);

      // Send final test_case (the "shrunk" replay)
      const finalDataChannel = serverConn.newChannel({ role: "FinalData" });
      const req3 = await testChannel.sendRequest({
        event: "test_case",
        channel_id: finalDataChannel.channelId,
      });
      await testChannel.receiveResponseRaw(req3);
      // Wait for mark_complete from client
      await finalDataChannel.receiveRequest({ timeoutMs: 5000 });
      await finalDataChannel.sendResponseValue(0, null);
      finalDataChannel.close();
    })();

    await clientConn.sendHandshake();
    const client = new Client(clientConn);

    // Override _runTestCase so the final run doesn't throw (test "passes" when it shouldn't)
    const origRunTestCase = client._runTestCase.bind(client);
    client._runTestCase = async (ch: Channel, fn: () => void | Promise<void>, isFinal: boolean) => {
      if (isFinal) {
        // Don't run fn — suppress the throw
        await ch.sendRequest({ command: "mark_complete", status: "VALID", origin: null });
        ch.close();
        return;
      }
      return origRunTestCase(ch, fn, isFinal);
    };

    await expect(client.runTest(() => {}, { testCases: 1 })).rejects.toThrow(
      "Expected test case to fail but it didn't",
    );

    await serverTask;
    clientConn.close();
    serverConn.close();
  });

  it("raises AggregateError with 'Expected test case N to fail' for multiple interesting", async () => {
    const [serverSock, clientSock] = await socketPair();
    const serverConn = new Connection(serverSock, { name: "Server" });
    const clientConn = new Connection(clientSock, { name: "Client" });

    // N_INTERESTING = 2: both final runs pass
    const N_INTERESTING = 2;

    const serverTask = (async () => {
      await rawHandshakeResponder(serverConn);
      const control = serverConn.controlChannel;
      const [msgId, message] = await control.receiveRequest();
      const msg = message as Record<string, unknown>;
      const testChannelId = msg["channel_id"] as number;
      const testChannel = serverConn.connectChannel(testChannelId, { role: "Test" });
      await control.sendResponseValue(msgId, true);

      // Send test_done immediately with 2 interesting cases
      const req2 = await testChannel.sendRequest({
        event: "test_done",
        results: {
          passed: false,
          test_cases: 0,
          valid_test_cases: 0,
          invalid_test_cases: 0,
          interesting_test_cases: N_INTERESTING,
        },
      });
      await testChannel.receiveResponseRaw(req2);

      // Send 2 final test cases
      for (let i = 0; i < N_INTERESTING; i++) {
        const finalDataChannel = serverConn.newChannel({ role: `FinalData${i}` });
        const req = await testChannel.sendRequest({
          event: "test_case",
          channel_id: finalDataChannel.channelId,
        });
        await testChannel.receiveResponseRaw(req);
        // Client will send mark_complete before we signal them to; just read it
        const [mcMsgId] = await finalDataChannel.receiveRequest({ timeoutMs: 5000 });
        await finalDataChannel.sendResponseValue(mcMsgId, null);
        finalDataChannel.close();
      }
    })();

    await clientConn.sendHandshake();
    const client = new Client(clientConn);

    // Override so final runs always pass (no throw)
    client._runTestCase = async (
      ch: Channel,
      _fn: () => void | Promise<void>,
      _isFinal: boolean,
    ) => {
      await ch.sendRequest({ command: "mark_complete", status: "VALID", origin: null });
      ch.close();
    };

    await expect(client.runTest(() => {}, { testCases: 1 })).rejects.toThrow(AggregateError);

    await serverTask;
    clientConn.close();
    serverConn.close();
  });
});

// ---------------------------------------------------------------------------
// generateFromSchema context variable mutations
// ---------------------------------------------------------------------------

describe("generateFromSchema", () => {
  it("sets testAborted=true on StopTest (via HEGEL_PROTOCOL_TEST_MODE)", async () => {
    let wasAborted = false;
    await withTestMode("stop_test_on_generate", async (session) => {
      await session.runTest(async () => {
        try {
          await generateFromSchema({ type: "boolean" }, _testContextStorage.getStore()!);
        } catch (e) {
          if (e instanceof DataExhausted) {
            const data = _testContextStorage.getStore();
            wasAborted = data?.testAborted ?? false;
            throw e; // re-throw so runner handles it
          }
          throw e;
        }
      }, 5);
    });
    expect(wasAborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// draw
// ---------------------------------------------------------------------------

describe("draw", () => {
  it("throws RuntimeError outside test context", async () => {
    const gen = new BasicGenerator({ type: "boolean" });
    await expect(draw(gen)).rejects.toThrow("draw() cannot be called outside of a Hegel test");
  });
});
