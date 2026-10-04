import { describe, test, expect, vi } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { Pool, run, runAsync, DEFAULT_STEP_COUNT, type StateMachine } from "../src/stateful.js";

/**
 * Run `body` as a Hegel test with deterministic settings, swallowing its
 * failure, and return everything written to stderr — where the final replay
 * of a failing case prints its notes and draws.
 */
function captureReplay(body: (tc: hegel.TestCase) => void, testCases = 200): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    hegel.test(body, { testCases, database: hegel.Database.disabled, derandomize: true });
  } catch {
    // The failure itself is what the caller is inspecting the replay of.
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

const deterministic: Partial<hegel.Settings> = {
  database: hegel.Database.disabled,
  derandomize: true,
};

// ---------------------------------------------------------------------------
// Rules and invariants
// ---------------------------------------------------------------------------

interface Stack {
  items: number[];
}

const stackMachine: StateMachine<Stack> = {
  rules: {
    push: (tc, stack) => {
      stack.items.push(tc.draw(gs.integers()));
    },
    pop: (tc, stack) => {
      tc.assume(stack.items.length > 0);
      stack.items.pop();
    },
    pushPop: (tc, stack) => {
      const element = tc.draw(gs.integers());
      const before = [...stack.items];
      stack.items.push(element);
      expect(stack.items.pop()).toBe(element);
      expect(stack.items).toEqual(before);
    },
  },
  invariants: {
    lengthAgreesWithEmptiness: (_tc, stack) => {
      expect(stack.items.length === 0).toBe(stack.items.length === 0);
    },
  },
};

describe("stateful.run", () => {
  test("a correct machine passes", () =>
    hegel.test(
      (tc) => {
        run(tc, stackMachine, { items: [] });
      },
      { testCases: 20 },
    ));

  test("a machine with no invariants passes", () =>
    hegel.test(
      (tc) => {
        run(tc, { rules: { noop: () => {} } }, {});
      },
      { testCases: 5 },
    ));

  test("a violated invariant fails the test with the invariant's error", () => {
    interface Linear {
      state: number;
    }
    const step = (expected: number) => (tc: hegel.TestCase, s: Linear) => {
      tc.assume(s.state === expected);
      s.state += 1;
    };
    const linear: StateMachine<Linear> = {
      rules: { zero: step(0), one: step(1), two: step(2), three: step(3) },
      invariants: {
        upperBound: (_tc, s) => {
          if (s.state >= 4) throw new Error(`state reached ${s.state}`);
        },
      },
    };
    expect(() =>
      hegel.test((tc) => {
        run(tc, linear, { state: 0 });
      }, deterministic),
    ).toThrow(/state reached 4/);
  });

  test("a rule that throws fails the test with the rule's error", () => {
    expect(() =>
      hegel.test((tc) => {
        run(
          tc,
          {
            rules: {
              alwaysFails: () => {
                throw new Error("boom");
              },
            },
          },
          {},
        );
      }, deterministic),
    ).toThrow(/boom/);
  });

  test("irrelevant steps are shrunk away and the replay names each step", () => {
    interface Counter {
      count: number;
    }
    const bump: StateMachine<Counter> = {
      rules: {
        bump: (_tc, s) => {
          s.count += 1;
        },
        noop: () => {},
      },
      invariants: {
        belowThree: (_tc, s) => {
          if (s.count >= 3) throw new Error(`count is ${s.count}`);
        },
      },
    };
    const output = captureReplay((tc) => {
      run(tc, bump, { count: 0 });
    });
    const stepLines = output.split("\n").filter((line) => line.startsWith("Step "));
    expect(stepLines).toEqual(["Step 1: bump", "Step 2: bump", "Step 3: bump"]);
    expect(output).not.toContain("noop");
    expect(output).toContain("Invariant belowThree failed after step 3:");
    expect(output).toContain("count is 3");
  });

  test("the replay shows a rule's draws and names a failing rule", () => {
    const output = captureReplay((tc) => {
      run(
        tc,
        {
          rules: {
            tooBig: (tc) => {
              const n = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
              if (n >= 10) throw new Error(`${n} is too big`);
            },
          },
        },
        {},
      );
    });
    expect(output).toContain("Step 1: tooBig");
    expect(output).toContain("var draw_1 = 10;");
    expect(output).toContain("Rule tooBig failed:");
    expect(output).not.toContain("violated assumption");
  });

  test("a rejected step is reported as a violated assumption in the replay", () => {
    // Rejection is not transactional: `mark` has already flipped the flag
    // when its assumption fails, so the minimal failing case keeps the
    // rejected step and the replay shows how it ended.
    interface Marked {
      marked: boolean;
    }
    const output = captureReplay((tc) => {
      run<Marked>(
        tc,
        {
          rules: {
            mark: (tc, s) => {
              s.marked = true;
              tc.assume(false);
            },
          },
          invariants: {
            unmarked: (_tc, s) => {
              if (s.marked) throw new Error("marked");
            },
          },
        },
        { marked: false },
      );
    });
    expect(output).toContain("Step 1: mark");
    expect(output).toContain("Rule stopped early due to violated assumption.");
  });

  test("invariants are checked on the initial state", () => {
    const output = captureReplay((tc) => {
      run(
        tc,
        {
          rules: {
            increment: (_tc, s) => {
              s.num += 1;
            },
          },
          invariants: {
            nonZero: (_tc, s) => {
              if (s.num === 0) throw new Error("num is 0");
            },
          },
        },
        { num: 0 },
      );
    });
    expect(output).toContain("Invariant nonZero failed in the initial state:");
    expect(output).toContain("num is 0");
  });

  test("every invariant runs at each guaranteed check", () => {
    expect(() =>
      hegel.test((tc) => {
        run(
          tc,
          {
            rules: { noop: () => {} },
            invariants: {
              first: (_tc, s) => {
                s.firstRan = true;
              },
              second: (_tc, s) => {
                if (s.firstRan) throw new Error("all invariants ran");
              },
            },
          },
          { firstRan: false },
        );
      }, deterministic),
    ).toThrow(/all invariants ran/);
  });

  test("a persistent violation is caught despite sampling", () => {
    expect(() =>
      hegel.test((tc) => {
        run(
          tc,
          {
            rules: {
              breakIt: (_tc, s) => {
                s.broken = true;
              },
            },
            invariants: {
              notBroken: (_tc, s) => {
                if (s.broken) throw new Error("machine is broken");
              },
            },
          },
          { broken: false },
        );
      }, deterministic),
    ).toThrow(/machine is broken/);
  });

  test("invariants are sampled rather than run after every rule", () => {
    let rulesRun = 0;
    let invariantsRun = 0;
    hegel.test(
      (tc) => {
        run(
          tc,
          {
            rules: {
              count: () => {
                rulesRun++;
              },
            },
            invariants: {
              // The object form without `alwaysCheck` is sampled too.
              count: {
                check: () => {
                  invariantsRun++;
                },
              },
            },
          },
          {},
        );
      },
      { testCases: 20, ...deterministic },
    );
    expect(invariantsRun).toBeGreaterThanOrEqual(2);
    expect(invariantsRun).toBeLessThan(rulesRun / 4);
  });

  test("alwaysCheck invariants run after every rule", () => {
    hegel.test(
      (tc) => {
        run(
          tc,
          {
            rules: {
              step: (_tc, s) => {
                s.uncheckedSteps += 1;
              },
            },
            invariants: {
              atMostOneStepSinceLastCheck: {
                alwaysCheck: true,
                check: (_tc, s) => {
                  if (s.uncheckedSteps > 1) {
                    throw new Error(`invariant missed ${s.uncheckedSteps} rules`);
                  }
                  s.uncheckedSteps = 0;
                },
              },
            },
          },
          { uncheckedSteps: 0 },
        );
      },
      { testCases: 20, ...deterministic },
    );
  });

  test("alwaysCheck invariants are not sampled while sampled ones still are", () => {
    let rulesRun = 0;
    let sampledRuns = 0;
    let alwaysRuns = 0;
    hegel.test(
      (tc) => {
        run(
          tc,
          {
            rules: {
              count: () => {
                rulesRun++;
              },
            },
            invariants: {
              sampled: () => {
                sampledRuns++;
              },
              always: {
                alwaysCheck: true,
                check: () => {
                  alwaysRuns++;
                },
              },
            },
          },
          {},
        );
      },
      { testCases: 20, ...deterministic },
    );
    // Every rule plus the initial and final states.
    expect(alwaysRuns).toBeGreaterThan(rulesRun);
    expect(sampledRuns).toBeLessThan(rulesRun / 4);
  });
});

// ---------------------------------------------------------------------------
// Step budget
// ---------------------------------------------------------------------------

/**
 * Run `testCases` cases of a one-rule machine whose rule rejects its
 * assumption when `reject(attempt)` says so; return the number of completed
 * steps per test case.
 */
function completedSteps(
  testCases: number,
  stepCount: number | undefined,
  reject: (attempt: number) => boolean = () => false,
): number[] {
  const counts: number[] = [];
  hegel.test(
    (tc) => {
      let completed = 0;
      let attempts = 0;
      run(
        tc,
        {
          rules: {
            step: (tc) => {
              attempts++;
              tc.assume(!reject(attempts));
              completed++;
            },
          },
        },
        {},
        stepCount === undefined ? undefined : { stepCount },
      );
      counts.push(completed);
    },
    { testCases, ...deterministic },
  );
  return counts;
}

describe("step budget", () => {
  test("every test case runs at least one step", () => {
    expect(completedSteps(100, undefined).every((c) => c >= 1)).toBe(true);
  });

  test("the default cap is 50 steps, reached most of the time", () => {
    expect(DEFAULT_STEP_COUNT).toBe(50);
    const counts = completedSteps(100, undefined);
    expect(counts.every((c) => c <= 50)).toBe(true);
    expect(counts.filter((c) => c === 50).length).toBeGreaterThan(counts.length / 2);
  });

  test("stepCount replaces the default cap", () => {
    const counts = completedSteps(100, 7);
    expect(counts.every((c) => c >= 1 && c <= 7)).toBe(true);
    expect(counts.filter((c) => c === 7).length).toBeGreaterThan(counts.length / 2);
  });

  test("rejected steps do not consume the budget", () => {
    // The rule rejects every other attempt, yet most cases still complete
    // the full budget of successful steps.
    const counts = completedSteps(100, 10, (attempt) => attempt % 2 === 1);
    expect(counts.every((c) => c <= 10)).toBe(true);
    expect(counts.filter((c) => c === 10).length).toBeGreaterThan(counts.length / 2);
  });
});

// ---------------------------------------------------------------------------
// Usage errors
// ---------------------------------------------------------------------------

describe("usage errors", () => {
  test("a machine with no rules is rejected", () => {
    expect(() =>
      hegel.test((tc) => {
        run(tc, { rules: {} }, {});
      }, deterministic),
    ).toThrow(/cannot run a state machine with no rules/);
  });

  test("a stepCount below 1 or non-integral is rejected", () => {
    for (const stepCount of [0, -3, 2.5]) {
      expect(() =>
        hegel.test((tc) => {
          run(tc, { rules: { noop: () => {} } }, {}, { stepCount });
        }, deterministic),
      ).toThrow(/stepCount must be a positive integer/);
    }
  });

  test("run rejects a rule that returns a Promise", () => {
    expect(() =>
      hegel.test((tc) => {
        run(
          tc,
          {
            rules: {
              // Rejects after `run` has already given up on it: the detached
              // rejection must be swallowed rather than surface as unhandled.
              slow: async () => {
                await Promise.resolve();
                throw new Error("too late");
              },
            },
          },
          {},
        );
      }, deterministic),
    ).toThrow(/returned a Promise.*runAsync/);
  });
});

// ---------------------------------------------------------------------------
// Async machines
// ---------------------------------------------------------------------------

describe("stateful.runAsync", () => {
  test("awaits asynchronous rules and invariants", async () => {
    let steps = 0;
    await hegel.testAsync(
      async (tc) => {
        await runAsync(
          tc,
          {
            rules: {
              increment: async (_tc, s) => {
                await Promise.resolve();
                s.value += 1;
                steps++;
              },
              skip: async (tc) => {
                await Promise.resolve();
                tc.assume(false);
              },
              syncToo: (_tc, s) => {
                s.value += 1;
                steps++;
              },
            },
            invariants: {
              nonNegative: async (_tc, s) => {
                await Promise.resolve();
                expect(s.value).toBeGreaterThanOrEqual(0);
              },
            },
          },
          { value: 0 },
        );
      },
      { testCases: 20, ...deterministic },
    );
    expect(steps).toBeGreaterThan(0);
  });

  test("a rejected async invariant fails the test", async () => {
    await expect(
      hegel.testAsync(async (tc) => {
        await runAsync(
          tc,
          {
            rules: {
              increment: async (_tc, s) => {
                await Promise.resolve();
                s.value += 1;
              },
            },
            invariants: {
              belowThree: async (_tc, s) => {
                await Promise.resolve();
                if (s.value >= 3) throw new Error(`value is ${s.value}`);
              },
            },
          },
          { value: 0 },
        );
      }, deterministic),
    ).rejects.toThrow(/value is 3/);
  });
});

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

describe("stateful.Pool", () => {
  test("rules draw values that earlier rules added", () => {
    interface Tracked {
      pool: Pool<number>;
      added: Set<number>;
      addedCount: number;
    }
    const tracked: StateMachine<Tracked> = {
      rules: {
        add: (tc, s) => {
          const n = tc.draw(gs.integers());
          s.pool.add(n);
          s.added.add(n);
          s.addedCount++;
        },
        reuse: (tc, s) => {
          const n = tc.draw(s.pool.valuesReusable());
          expect(s.added.has(n)).toBe(true);
        },
        consume: (tc, s) => {
          const before = s.pool.size;
          const n = tc.draw(s.pool.valuesConsumed());
          expect(s.added.has(n)).toBe(true);
          expect(s.pool.size).toBe(before - 1);
        },
      },
      invariants: {
        sizeIsBounded: (_tc, s) => {
          expect(s.pool.size).toBeLessThanOrEqual(s.addedCount);
        },
      },
    };
    hegel.test(
      (tc) => {
        run(tc, tracked, { pool: new Pool<number>(tc), added: new Set(), addedCount: 0 });
      },
      { testCases: 50, ...deterministic },
    );
  });

  test("a consumed value is never drawn again", () => {
    hegel.test(
      (tc) => {
        const elements = tc.draw(gs.sets(gs.integers()));
        tc.assume(elements.size > 0);
        const pool = new Pool<number>(tc);
        for (const element of elements) pool.add(element);
        const consumed = tc.draw(pool.valuesConsumed());
        expect(pool.size).toBe(elements.size - 1);
        run(
          tc,
          {
            rules: {
              draw: (tc) => {
                expect(tc.draw(pool.valuesReusable())).not.toBe(consumed);
              },
            },
          },
          {},
        );
      },
      { testCases: 50, ...deterministic },
    );
  });

  test("a draw from an empty pool rejects the step", () => {
    let drawsSucceeded = 0;
    hegel.test(
      (tc) => {
        const pool = new Pool<string>(tc);
        run(
          tc,
          {
            rules: {
              fill: () => {
                pool.add("x");
              },
              drain: (tc) => {
                // Rejects (rather than failing) while the pool is empty.
                tc.draw(pool.valuesConsumed());
                drawsSucceeded++;
              },
            },
          },
          {},
        );
      },
      { testCases: 30, ...deterministic },
    );
    expect(drawsSucceeded).toBeGreaterThan(0);
  });

  test("pool choices shrink like other draws", () => {
    // Each `charge` step deepens a charge from the pool; the failure needs a
    // chain of three, and the replay reports the shrunk chain.
    interface Charged {
      charges: Pool<{ depth: number }>;
    }
    const output = captureReplay((tc) => {
      run<Charged>(
        tc,
        {
          rules: {
            charge: (tc, s) => {
              const { depth } = tc.draw(s.charges.valuesReusable());
              s.charges.add({ depth: depth + 1 });
            },
            newCharge: (_tc, s) => {
              s.charges.add({ depth: 0 });
            },
            notTooDeep: (tc, s) => {
              const { depth } = tc.draw(s.charges.valuesReusable());
              if (depth >= 3) throw new Error(`depth ${depth} is not less than 3`);
            },
          },
        },
        { charges: new Pool(tc) },
      );
    }, 1000);
    expect(output).toContain("depth 3 is not less than 3");
    const stepLines = output.split("\n").filter((line) => line.startsWith("Step "));
    expect(stepLines).toHaveLength(5);
  });

  test("using a pool with another test case is an error", () => {
    let stale: Pool<number> | null = null;
    hegel.test(
      (tc) => {
        stale = new Pool<number>(tc);
        stale.add(1);
      },
      { testCases: 1, ...deterministic },
    );
    expect(() =>
      hegel.test(
        (tc) => {
          tc.draw(stale!.valuesReusable());
        },
        { testCases: 1, ...deterministic },
      ),
    ).toThrow(/belongs to a different test case/);
  });
});
