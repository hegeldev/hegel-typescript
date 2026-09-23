import { describe, it, expect, vi } from "vitest";
import { EngineError, RunStatus, Status } from "../src/engine.js";
import {
  createRunner,
  EngineDataSource,
  runTestCase,
  runTestCaseAsync,
} from "../src/runnerCore.js";
import { AssumeError, StopTestError } from "../src/testCase.js";
import * as gs from "../src/generators/index.js";
import { fakeEngine, fakeRuntime, context, testCase, replayCase } from "./fakeEngine.js";

describe("runnerCore engine fault classification and cleanup", () => {
  for (const async of [false, true]) {
    it(`closes the ${async ? "async" : "sync"} generator on an adapter exception`, async () => {
      const engine = fakeEngine();
      const trap = new Error("adapter trap");
      engine.generateBoolean.mockImplementation(() => {
        throw trap;
      });
      const runner = createRunner(fakeRuntime(engine));
      const body = (tc: import("../src/testCase.js").TestCase) => {
        tc.draw(gs.booleans());
      };
      if (async) await expect(runner.testAsync(body)).rejects.toThrow("adapter trap");
      else expect(() => runner.test(body)).toThrow("adapter trap");
      expect(engine.nextTestCase).toHaveBeenCalledTimes(1);
      expect(engine.markComplete).toHaveBeenCalledExactlyOnceWith(
        context,
        testCase,
        Status.INVALID,
        null,
      );
      expect(engine.freeTestCase).toHaveBeenCalledExactlyOnceWith(testCase);
      expect(engine.freeRun).toHaveBeenCalledTimes(1);
      expect(engine.freeSettings).toHaveBeenCalledTimes(1);
      expect(engine.freeContext).toHaveBeenCalledTimes(1);
      expect(engine.runResult).not.toHaveBeenCalled();
    });

    it.each(["draw", "completion"])(
      `retains %s and outer-free faults in the ${async ? "async" : "sync"} driver`,
      async (stage) => {
        const engine = fakeEngine();
        const cause = new Error("original cause");
        const fault = new EngineError(`${stage} broke`, { cause });
        const freeFault = new EngineError("context free broke");
        engine[stage === "draw" ? "generateBoolean" : "markComplete"].mockImplementation(() => {
          throw fault;
        });
        engine.freeContext.mockImplementation(() => {
          throw freeFault;
        });
        const runner = createRunner(fakeRuntime(engine));
        const body = (tc: import("../src/testCase.js").TestCase) => tc.draw(gs.booleans());
        let error: unknown;
        try {
          if (async) await runner.testAsync(body);
          else runner.test(body);
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toEqual([fault, freeFault]);
        expect((error as AggregateError).errors[0].cause).toBe(cause);
        expect(engine.markComplete).toHaveBeenCalledTimes(1);
        expect(engine.freeTestCase).toHaveBeenCalledTimes(1);
        expect(engine.freeRun).toHaveBeenCalledTimes(1);
        expect(engine.freeSettings).toHaveBeenCalledTimes(1);
        expect(engine.freeContext).toHaveBeenCalledTimes(1);
        expect(engine.runResult).not.toHaveBeenCalled();
      },
    );

    it(`does not retry failed completion in the ${async ? "async" : "sync"} driver`, async () => {
      const engine = fakeEngine();
      engine.markComplete.mockImplementation(() => {
        throw new EngineError("completion broke");
      });
      const runner = createRunner(fakeRuntime(engine));
      if (async) await expect(runner.testAsync(() => {})).rejects.toThrow("completion broke");
      else expect(() => runner.test(() => {})).toThrow("completion broke");
      expect(engine.markComplete).toHaveBeenCalledTimes(1);
      expect(engine.freeTestCase).toHaveBeenCalledTimes(1);
      expect(engine.freeRun).toHaveBeenCalledTimes(1);
      expect(engine.freeContext).toHaveBeenCalledTimes(1);
    });

    it(`retains draw and completion faults in the ${async ? "async" : "sync"} driver`, async () => {
      const engine = fakeEngine();
      engine.generateBoolean.mockImplementation(() => {
        throw new EngineError("draw broke");
      });
      engine.markComplete.mockImplementation(() => {
        throw new EngineError("completion broke");
      });
      const runner = createRunner(fakeRuntime(engine));
      const body = (tc: import("../src/testCase.js").TestCase) => tc.draw(gs.booleans());
      let error: unknown;
      try {
        if (async) await runner.testAsync(body);
        else runner.test(body);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
        "draw broke",
        "completion broke",
      ]);
      expect(engine.markComplete).toHaveBeenCalledTimes(1);
      expect(engine.freeTestCase).toHaveBeenCalledTimes(1);
    });
  }

  it("does not let user code swallow an adapter fault", () => {
    const engine = fakeEngine();
    engine.generateBoolean.mockImplementation(() => {
      throw new EngineError("persistent fault");
    });
    expect(() =>
      createRunner(fakeRuntime(engine)).test((tc) => {
        try {
          tc.draw(gs.booleans());
        } catch {
          /* Deliberately catch user-visible error. */
        }
      }),
    ).toThrow("persistent fault");
    expect(engine.markComplete).toHaveBeenCalledWith(context, testCase, Status.INVALID, null);
  });

  it.each([new AssumeError(), new StopTestError()])(
    "keeps ordinary draw control flow out of failures",
    (error) => {
      const engine = fakeEngine();
      engine.generateBoolean.mockImplementation(() => {
        throw error;
      });
      createRunner(fakeRuntime(engine)).test((tc) => tc.draw(gs.booleans()));
      expect(engine.markComplete).toHaveBeenCalledWith(
        context,
        testCase,
        error instanceof AssumeError ? Status.INVALID : Status.OVERRUN,
        null,
      );
    },
  );

  it("rejects duplicate completion attempts before calling the engine", () => {
    const engine = fakeEngine();
    const ds = new EngineDataSource(engine, context, testCase);
    ds.markComplete(Status.VALID, null);
    expect(() => ds.markComplete(Status.VALID, null)).toThrow("already attempted");
    expect(engine.markComplete).toHaveBeenCalledTimes(1);
    ds.dispose();
  });

  it("releases context when settings construction fails", () => {
    const engine = fakeEngine();
    engine.newSettings.mockImplementation(() => {
      throw new EngineError("settings allocation");
    });
    expect(() => createRunner(fakeRuntime(engine)).test(() => {})).toThrow("settings allocation");
    expect(engine.freeContext).toHaveBeenCalledTimes(1);
    expect(engine.freeSettings).not.toHaveBeenCalled();
  });

  it("validates runtime settings before acquiring the engine", () => {
    const runtime = fakeRuntime(fakeEngine());
    runtime.getEngine = vi.fn(runtime.getEngine);
    runtime.validateSettings = () => {
      throw new Error("unsupported database");
    };
    expect(() => createRunner(runtime).test(() => {})).toThrow("unsupported database");
    expect(runtime.getEngine).not.toHaveBeenCalled();
  });

  it("releases all collections, case, cache and outer handles when one collection free fails", () => {
    const engine = fakeEngine();
    engine.freeCollection.mockImplementationOnce(() => {
      throw new EngineError("collection free");
    });
    expect(() =>
      createRunner(fakeRuntime(engine)).test((tc) => {
        tc.draw(gs.text());
        tc.dataSource().newCollection(0, 1);
        tc.dataSource().newCollection(0, 1);
      }),
    ).toThrow("collection free");
    expect(engine.freeCollection).toHaveBeenCalledTimes(2);
    expect(engine.freeStringGenerator).toHaveBeenCalledTimes(1);
    expect(engine.freeTestCase).toHaveBeenCalledTimes(1);
    expect(engine.freeRun).toHaveBeenCalledTimes(1);
    expect(engine.freeSettings).toHaveBeenCalledTimes(1);
    expect(engine.freeContext).toHaveBeenCalledTimes(1);
  });

  it("keeps stop-span engine faults visible", () => {
    const engine = fakeEngine();
    engine.stopSpan.mockImplementation(() => {
      throw new EngineError("stop span");
    });
    expect(() =>
      createRunner(fakeRuntime(engine)).test((tc) => {
        tc.startSpan(1);
        tc.stopSpan();
      }),
    ).toThrow("stop span");
    expect(engine.markComplete).toHaveBeenCalledWith(context, testCase, Status.INVALID, null);
  });
});

describe("runnerCore run results and replay", () => {
  it.each([RunStatus.FAILED_NONDETERMINISTIC, 99, RunStatus.ERROR])(
    "never replays status %s",
    (status) => {
      const engine = fakeEngine();
      engine.runStatus.mockReturnValue(status);
      expect(() => createRunner(fakeRuntime(engine)).test(() => {})).toThrow(
        status === RunStatus.FAILED_NONDETERMINISTIC
          ? /nondeterministic/
          : status === 99
            ? /Unknown Hegel/
            : /backend error/,
      );
      expect(engine.failureCount).not.toHaveBeenCalled();
      expect(engine.testCaseFromBlob).not.toHaveBeenCalled();
      expect(engine.freeRunResult).toHaveBeenCalledTimes(1);
      expect(engine.freeRun).toHaveBeenCalledTimes(1);
    },
  );

  it("does not interpret a missing failure blob as a fresh test case", () => {
    const engine = fakeEngine();
    engine.runStatus.mockReturnValue(RunStatus.FAILED);
    engine.reproductionBlob.mockReturnValue(null);
    expect(() => createRunner(fakeRuntime(engine)).test(() => {})).toThrow("no reproduction blob");
    expect(engine.testCaseFromBlob).not.toHaveBeenCalled();
    expect(engine.freeFailure).toHaveBeenCalledTimes(1);
    expect(engine.freeRunResult).toHaveBeenCalledTimes(1);
  });

  it.each(["valid", "invalid", "overrun"])(
    "reports a non-reproducing %s final replay explicitly",
    (status) => {
      const engine = fakeEngine();
      engine.runStatus.mockReturnValue(RunStatus.FAILED);
      expect(() =>
        createRunner(fakeRuntime(engine)).test((tc) => {
          if (tc.isLastRun && status === "invalid") throw new AssumeError();
          if (tc.isLastRun && status === "overrun") throw new StopTestError();
        }),
      ).toThrow(`did not reproduce during final replay (status: ${status})`);
      expect(engine.freeTestCase).toHaveBeenCalledWith(replayCase);
      expect(engine.markComplete).toHaveBeenCalledTimes(2);
    },
  );

  it("frees replay handles on an engine fault instead of reporting a counterexample", () => {
    const engine = fakeEngine();
    engine.runStatus.mockReturnValue(RunStatus.FAILED);
    expect(() =>
      createRunner(fakeRuntime(engine)).test((tc) => {
        if (tc.isLastRun) throw new EngineError("replay engine fault");
      }),
    ).toThrow("replay engine fault");
    expect(engine.freeTestCase).toHaveBeenCalledWith(replayCase);
    expect(engine.markComplete).toHaveBeenLastCalledWith(context, replayCase, Status.INVALID, null);
    expect(engine.freeRunResult).toHaveBeenCalledTimes(1);
  });

  it("passes locations to the runtime for Antithesis reporting", () => {
    const runtime = fakeRuntime(fakeEngine());
    const location = { function: "property", file: "test.ts", class: "tests", beginLine: 1 };
    new (createRunner(runtime).Hegel)(() => {}).testLocation(location).runSync();
    expect(runtime.emitAntithesisAssertion).toHaveBeenCalledWith(location, true);
  });
});

describe("runnerCore origin formats", () => {
  it.each([
    [
      "Error: failure\n    at dep (file:///node_modules/dep.js:1:1)\n    at property (file:///test.ts:4:5)",
      "at property (file:///test.ts:4:5)",
    ],
    [
      "dep@https://host/node_modules/dep.js:1:1\nproperty@https://host/test.ts:4:5",
      "property@https://host/test.ts:4:5",
    ],
    ["@https://host/test.ts:8:9", "@https://host/test.ts:8:9"],
    ["Error: no frames", "<unknown>"],
  ])("extracts an origin without assuming V8", (stack, origin) => {
    const engine = fakeEngine();
    const ds = new EngineDataSource(engine, context, testCase);
    const error = new Error("failure");
    error.stack = stack;
    const result = runTestCase(
      ds,
      () => {
        throw error;
      },
      false,
    );
    expect(result.status).toBe("interesting");
    expect(engine.markComplete).toHaveBeenCalledWith(context, testCase, Status.INTERESTING, origin);
    ds.dispose();
  });
});

it("EngineDataSource disposes its own cache after collection cleanup fails", () => {
  const engine = fakeEngine();
  const ds = new EngineDataSource(engine, context, testCase);
  ds.newCollection(0);
  ds.generate({ type: "email" });
  engine.freeCollection.mockImplementation(() => {
    throw new EngineError("collection free");
  });
  engine.freeStringGenerator.mockImplementation(() => {
    throw new EngineError("generator free");
  });
  expect(() => ds.dispose()).toThrow(AggregateError);
  expect(engine.freeCollection).toHaveBeenCalledTimes(1);
  expect(engine.freeStringGenerator).toHaveBeenCalledTimes(1);
  ds.dispose();
});

it("runTestCaseAsync uses portable diagnostics for custom data sources", async () => {
  const engine = fakeEngine();
  const ds = new EngineDataSource(engine, context, testCase);
  const source = {
    generate: ds.generate.bind(ds),
    startSpan: ds.startSpan.bind(ds),
    stopSpan: ds.stopSpan.bind(ds),
    newCollection: ds.newCollection.bind(ds),
    collectionMore: ds.collectionMore.bind(ds),
    collectionReject: ds.collectionReject.bind(ds),
    markComplete: ds.markComplete.bind(ds),
  };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await runTestCaseAsync(
      source,
      () => {
        throw new Error("user failure");
      },
      true,
    );
    expect(result.status).toBe("interesting");
    expect(log).toHaveBeenCalledWith("\nuser failure");
  } finally {
    log.mockRestore();
    ds.dispose();
  }
});

it("retains a run error through multiple failing outer destructors", () => {
  const engine = fakeEngine();
  engine.runStatus.mockReturnValue(RunStatus.ERROR);
  const resultFault = new EngineError("result free");
  const runFault = new EngineError("run free");
  const cacheFault = new EngineError("cache free");
  const settingsFault = new EngineError("settings free");
  const contextFault = new EngineError("context free");
  engine.freeRunResult.mockImplementation(() => {
    throw resultFault;
  });
  engine.freeRun.mockImplementation(() => {
    throw runFault;
  });
  engine.freeStringGenerator.mockImplementation(() => {
    throw cacheFault;
  });
  engine.freeSettings.mockImplementation(() => {
    throw settingsFault;
  });
  engine.freeContext.mockImplementation(() => {
    throw contextFault;
  });
  let error: unknown;
  try {
    createRunner(fakeRuntime(engine)).test((tc) => tc.draw(gs.text()));
  } catch (caught) {
    error = caught;
  }
  const flatten = (error: unknown): unknown[] =>
    error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];
  const errors = flatten(error);
  expect(errors[0]).toBeInstanceOf(EngineError);
  expect((errors[0] as Error).message).toBe("backend error");
  expect(errors.slice(1)).toEqual([resultFault, runFault, cacheFault, settingsFault, contextFault]);
  for (const free of [
    engine.freeRunResult,
    engine.freeRun,
    engine.freeStringGenerator,
    engine.freeSettings,
    engine.freeContext,
  ])
    expect(free).toHaveBeenCalledTimes(1);
});

it("retains a failure-snapshot read error if its destructor also fails", () => {
  const engine = fakeEngine();
  engine.runStatus.mockReturnValue(RunStatus.FAILED);
  const readFault = new EngineError("blob read");
  const freeFault = new EngineError("failure free");
  engine.reproductionBlob.mockImplementation(() => {
    throw readFault;
  });
  engine.freeFailure.mockImplementation(() => {
    throw freeFault;
  });
  let error: unknown;
  try {
    createRunner(fakeRuntime(engine)).test(() => {});
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual([readFault, freeFault]);
  expect(engine.testCaseFromBlob).not.toHaveBeenCalled();
  expect(engine.freeRunResult).toHaveBeenCalledTimes(1);
  expect(engine.freeContext).toHaveBeenCalledTimes(1);
});
