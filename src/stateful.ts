/**
 * Stateful (model-based) testing.
 *
 * A stateful test applies a random sequence of *rules* to a piece of state
 * and checks *invariants* along the way. A rule is a function that takes the
 * {@link TestCase} and the state, draws whatever data it needs, and updates
 * the state (and the system under test) in place. An invariant is a property
 * of the state that must hold after every step.
 *
 * Describe the machine as a plain object — a {@link StateMachine} — mapping
 * rule names to rule functions and invariant names to invariant functions,
 * then call {@link run} (or {@link runAsync}, for asynchronous rules) inside a
 * Hegel test:
 *
 * ```ts
 * import { test } from "vitest";
 * import * as hegel from "@hegeldev/hegel";
 * import * as gs from "@hegeldev/hegel/generators";
 *
 * interface Stack {
 *   items: number[];
 * }
 *
 * const stackMachine: hegel.stateful.StateMachine<Stack> = {
 *   rules: {
 *     push: (tc, stack) => {
 *       stack.items.push(tc.draw(gs.integers()));
 *     },
 *     pop: (tc, stack) => {
 *       tc.assume(stack.items.length > 0);
 *       stack.items.pop();
 *     },
 *   },
 *   invariants: {
 *     nonNegativeLength: (_tc, stack) => {
 *       if (stack.items.length < 0) throw new Error("negative length");
 *     },
 *   },
 * };
 *
 * test("stack", () =>
 *   hegel.test((tc) => {
 *     hegel.stateful.run(tc, stackMachine, { items: [] });
 *   }));
 * ```
 *
 * The engine owns the run: it decides how many steps to take (at most
 * {@link RunOptions.stepCount}, 50 by default), which rule runs at each step
 * — applying *swarm testing*, where each test case enables a random subset of
 * the rules — and which sampled invariants to check after which steps. On
 * failure it shrinks the sequence of steps like any other input, and the
 * final replay reports each step as `Step N: <rule>` together with the draws
 * the rule made.
 *
 * Every invariant is checked on the initial state and on the final state. In
 * between, invariants are *sampled*: each is checked after any given step
 * with probability `1 / stepCount`, so its expected cost per test case stays
 * constant as the step count grows. Mark an invariant
 * `{ check, alwaysCheck: true }` to check it after every step instead — for
 * invariants that must observe every intermediate state, or that mutate the
 * state when checked.
 *
 * # Assumptions in rules
 *
 * A rule may reject the current step with {@link TestCase.assume}: the step
 * is dropped (it does not count toward the step budget) and the machine
 * carries on with another rule. Rejection is not transactional — anything the
 * rule did before the assumption failed has already happened — so place
 * assumptions at the start of the rule, before mutating the state or the
 * system under test. A {@link HegelGenerator.filter | filtered} generator that
 * runs out of retries rejects the step the same way.
 *
 * # Pools
 *
 * Rules often need to act on values that earlier rules produced — a handle
 * that was allocated, a key that was inserted. A {@link Pool} holds such
 * values: rules {@link Pool.add | add} to it and draw from the generators it
 * hands out, so which value a rule picks is a recorded, shrinkable choice
 * like any other draw.
 *
 * @packageDocumentation
 */

import { TestCase, AssumeError, Labels, type DataSource } from "./testCase.js";
import { Generator as HegelGenerator } from "./generators/core.js";

/**
 * A rule of a {@link StateMachine}: one action applied to the state. It
 * receives the test case, to draw the data it needs, and the state to act on.
 *
 * Rules run by {@link run} must be synchronous; rules run by
 * {@link runAsync} may return a `Promise`, which is awaited before the next
 * step.
 */
export type Rule<S> = (tc: TestCase, state: S) => void | Promise<void>;

/**
 * The body of an invariant: throws (or, under {@link runAsync}, rejects) when
 * the invariant is violated.
 */
export type InvariantCheck<S> = (tc: TestCase, state: S) => void | Promise<void>;

/** An invariant with options; see {@link Invariant}. */
export interface InvariantOptions<S> {
  check: InvariantCheck<S>;
  /**
   * Check after every step rather than sampling (default `false`). See the
   * module documentation for when to use this.
   */
  alwaysCheck?: boolean;
}

/**
 * An invariant of a {@link StateMachine}: either a bare {@link InvariantCheck}
 * (sampled between steps) or an {@link InvariantOptions} object.
 */
export type Invariant<S> = InvariantCheck<S> | InvariantOptions<S>;

/**
 * A state machine over states of type `S`: named rules and (optionally) named
 * invariants. The names appear in the failure report (`Step 3: pop`,
 * `Invariant nonNegativeLength failed after step 3:`).
 *
 * A machine object holds no state of its own, so one machine can be run
 * against a fresh initial state in every test case.
 */
export interface StateMachine<S> {
  rules: Record<string, Rule<S>>;
  invariants?: Record<string, Invariant<S>>;
}

/** Options for {@link run} and {@link runAsync}. */
export interface RunOptions {
  /**
   * The target number of steps per test case (default
   * {@link DEFAULT_STEP_COUNT}): every test case runs at least one step and
   * at most this many; most run exactly this many, and the shrinker is free
   * to shorten a failing one. Each sampled invariant is checked after any
   * given step with probability `1 / stepCount`. Must be at least 1.
   */
  stepCount?: number;
}

/** The step count {@link run} uses when {@link RunOptions.stepCount} is not given. */
export const DEFAULT_STEP_COUNT = 50;

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/**
 * A pool of previously generated values, for stateful tests.
 *
 * Create one per test case with `new Pool(tc)` (typically in the test body,
 * alongside the initial state) and populate it with {@link add}. To draw from
 * the pool, pass the generators it hands out to {@link TestCase.draw}:
 *
 * - {@link valuesReusable} yields a value in the pool without removing it.
 * - {@link valuesConsumed} removes the value it yields from the pool.
 *
 * Drawing from an empty pool rejects the current step, as if by
 * `tc.assume(false)`.
 *
 * @example
 * ```ts
 * interface Allocator {
 *   live: Set<number>;
 *   handles: hegel.stateful.Pool<number>;
 * }
 *
 * const allocator: hegel.stateful.StateMachine<Allocator> = {
 *   rules: {
 *     alloc: (_tc, state) => {
 *       const handle = allocate();
 *       state.live.add(handle);
 *       state.handles.add(handle);
 *     },
 *     free: (tc, state) => {
 *       // Draws a handle that a previous `alloc` step put in the pool.
 *       const handle = tc.draw(state.handles.valuesConsumed());
 *       release(handle);
 *       state.live.delete(handle);
 *     },
 *   },
 * };
 *
 * hegel.test((tc) => {
 *   const state = { live: new Set<number>(), handles: new hegel.stateful.Pool<number>(tc) };
 *   hegel.stateful.run(tc, allocator, state);
 * });
 * ```
 */
export class Pool<T> {
  private readonly dataSource: DataSource;
  private readonly poolId: number;
  private readonly values = new Map<bigint, T>();

  /** Create an empty pool tied to the test case `tc`. */
  constructor(tc: TestCase) {
    this.dataSource = tc.dataSource();
    this.poolId = this.dataSource.newPool();
  }

  /** The number of values currently in the pool. */
  get size(): number {
    return this.values.size;
  }

  /** Add a value to the pool. */
  add(value: T): void {
    const id = this.dataSource.poolAdd(this.poolId);
    this.values.set(id, value);
  }

  /** A generator over the values in the pool; drawing does not remove them. */
  valuesReusable(): HegelGenerator<T> {
    return new PoolValues(this, false);
  }

  /** A generator that removes each value it yields from the pool. */
  valuesConsumed(): HegelGenerator<T> {
    return new PoolValues(this, true);
  }

  /** @internal */
  take(tc: TestCase, consume: boolean): T {
    if (tc.dataSource() !== this.dataSource) {
      throw new Error(
        "this Pool belongs to a different test case; create a new Pool in each test case",
      );
    }
    const id = this.dataSource.poolGenerate(this.poolId, consume);
    // The engine only ever hands back ids it issued through `add`.
    const value = this.values.get(id) as T;
    if (consume) {
      this.values.delete(id);
    }
    return value;
  }
}

class PoolValues<T> extends HegelGenerator<T> {
  constructor(
    private readonly pool: Pool<T>,
    private readonly consume: boolean,
  ) {
    super();
  }

  doDraw(tc: TestCase): T {
    return this.pool.take(tc, this.consume);
  }
}

// ---------------------------------------------------------------------------
// Running a machine
// ---------------------------------------------------------------------------

/** What running a rule or invariant produced, reported back into the step loop. */
type Outcome = { ok: true } | { ok: false; error: unknown };

/** A rule or invariant invocation for the driver to run. */
type Action = () => void | Promise<void>;

interface NamedInvariant<S> {
  name: string;
  check: InvariantCheck<S>;
  alwaysCheck: boolean;
}

function namedInvariants<S>(
  invariants: Record<string, Invariant<S>> | undefined,
): NamedInvariant<S>[] {
  return Object.entries(invariants ?? {}).map(([name, invariant]) =>
    typeof invariant === "function"
      ? { name, check: invariant, alwaysCheck: false }
      : { name, check: invariant.check, alwaysCheck: invariant.alwaysCheck ?? false },
  );
}

/**
 * The step loop shared by {@link run} and {@link runAsync}: drives the
 * engine's state-machine protocol and yields each rule / invariant invocation
 * as an {@link Action} for the driver to run (synchronously or awaited),
 * resuming with its {@link Outcome}. Errors from the engine calls and
 * failures the loop decides to surface propagate out of `next()`.
 */
function* machineSteps<S>(
  tc: TestCase,
  machine: StateMachine<S>,
  state: S,
  options: RunOptions | undefined,
): IterableIterator<Action, void, Outcome> {
  const ruleNames = Object.keys(machine.rules);
  if (ruleNames.length === 0) {
    throw new Error("cannot run a state machine with no rules");
  }
  const stepCount = options?.stepCount ?? DEFAULT_STEP_COUNT;
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new Error(`stepCount must be a positive integer, got ${String(stepCount)}`);
  }
  const rules = ruleNames.map((name) => machine.rules[name]);
  const invariants = namedInvariants(machine.invariants);

  const dataSource = tc.dataSource();
  const machineId = dataSource.newStateMachine({
    ruleNames,
    invariantNames: invariants.map((invariant) => invariant.name),
    invariantAlwaysCheck: invariants.map((invariant) => invariant.alwaysCheck),
    stepCount,
  });

  // Run the invariants at a join point: all of them for the guaranteed checks
  // of the initial and final state, otherwise the ones the engine samples.
  function* checkInvariants(
    where: string,
    sample: boolean,
  ): IterableIterator<Action, void, Outcome> {
    for (let i = 0; i < invariants.length; i++) {
      if (sample && !dataSource.stateMachineShouldCheckInvariant(machineId, i)) {
        continue;
      }
      const { name, check } = invariants[i];
      const outcome = yield () => check(tc, state);
      if (!outcome.ok) {
        tc.note(`Invariant ${name} failed ${where}:`);
        throw outcome.error;
      }
    }
  }

  yield* checkInvariants("in the initial state", false);

  let step = 0;
  for (;;) {
    // Each round is one span, so the shrinker can delete a whole step at
    // once. The span is opened on the data source rather than through
    // `tc.startSpan` on purpose: the latter also suppresses the printing of
    // draws made inside it (they belong to some enclosing generator), whereas
    // a rule's draws are the test's own and should show in the replay.
    dataSource.startSpan(Labels.STATEFUL_RULE);
    if (!dataSource.stateMachineNextRound(machineId)) {
      dataSource.stopSpan(false);
      break;
    }
    // The engine hands out one rule per round for a sequential machine, but
    // that is engine policy, not protocol: pull rules until the join point.
    let rejected = false;
    for (;;) {
      const ruleIndex = dataSource.stateMachineNextRule(machineId);
      if (ruleIndex === null) {
        break;
      }
      const name = ruleNames[ruleIndex];
      step++;
      tc.note(`Step ${step}: ${name}`);
      const outcome = yield () => rules[ruleIndex](tc, state);
      if (outcome.ok) {
        continue;
      }
      if (outcome.error instanceof AssumeError) {
        dataSource.stateMachineRuleRejected(machineId);
        rejected = true;
        tc.note("Rule stopped early due to violated assumption.");
        continue;
      }
      tc.note(`Rule ${name} failed:`);
      dataSource.stopSpan(false);
      throw outcome.error;
    }
    // A round whose rule was rejected contributed nothing: discard its span.
    dataSource.stopSpan(rejected);

    yield* checkInvariants(`after step ${step}`, true);
  }

  yield* checkInvariants("in the final state", false);
}

/**
 * Run a stateful test: apply randomly chosen rules of `machine` to `state`,
 * checking its invariants along the way, as described in the module
 * documentation. Call it inside a {@link test} body; the initial `state` is
 * constructed there, so every test case starts afresh.
 *
 * Rules and invariants must be synchronous — one that returns a `Promise`
 * fails the test with a `TypeError`. Use {@link runAsync} (inside
 * {@link testAsync}) for asynchronous machines.
 *
 * Throws an `Error` if `machine` has no rules or `options.stepCount` is below 1.
 *
 * @example
 * ```ts
 * hegel.test((tc) => {
 *   hegel.stateful.run(tc, stackMachine, { items: [] }, { stepCount: 200 });
 * });
 * ```
 */
export function run<S>(
  tc: TestCase,
  machine: StateMachine<S>,
  state: S,
  options?: RunOptions,
): void {
  const steps = machineSteps(tc, machine, state, options);
  let next = steps.next();
  while (!next.done) {
    let outcome: Outcome;
    try {
      const result = next.value();
      if (result instanceof Promise) {
        // The action is still running detached; the TypeError below is the
        // reported failure, so its own eventual rejection must not surface
        // as an unhandled one on top.
        result.catch(() => undefined);
        throw new TypeError(
          "a rule or invariant returned a Promise. Use stateful.runAsync (inside hegel.testAsync) for asynchronous state machines.",
        );
      }
      outcome = { ok: true };
    } catch (error: unknown) {
      outcome = { ok: false, error };
    }
    next = steps.next(outcome);
  }
}

/**
 * {@link run} for machines whose rules or invariants are asynchronous: each
 * is awaited before the next step. Call it inside a {@link testAsync} body.
 * Draws themselves are synchronous, so only the user's own `await`s yield.
 *
 * @example
 * ```ts
 * hegel.testAsync(async (tc) => {
 *   await hegel.stateful.runAsync(tc, clientMachine, { client: await connect() });
 * });
 * ```
 */
export async function runAsync<S>(
  tc: TestCase,
  machine: StateMachine<S>,
  state: S,
  options?: RunOptions,
): Promise<void> {
  const steps = machineSteps(tc, machine, state, options);
  let next = steps.next();
  while (!next.done) {
    let outcome: Outcome;
    try {
      await next.value();
      outcome = { ok: true };
    } catch (error: unknown) {
      outcome = { ok: false, error };
    }
    next = steps.next(outcome);
  }
}
