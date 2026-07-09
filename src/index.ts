/**
 * Hegel is a property-based testing library for TypeScript. Hegel is based on
 * [Hypothesis](https://github.com/hypothesisworks/hypothesis), using the
 * [Hegel protocol](https://hegel.dev/).
 *
 * # Getting started
 *
 * This guide walks you through the basics of installing Hegel and writing your
 * first tests.
 *
 * ## Install Hegel
 *
 * Add `@hegeldev/hegel` to your project as a dev dependency:
 *
 * ```bash
 * npm install --save-dev @hegeldev/hegel
 * ```
 *
 * Hegel requires Node 20.11+. Bun and Deno are not currently supported.
 *
 * ## Write your first test
 *
 * You're now ready to write your first test. We'll use
 * [Vitest](https://vitest.dev/) as the test runner for the purposes of this
 * guide. Create a new test file:
 *
 * ```ts
 * import { test } from "vitest";
 * import * as hegel from "@hegeldev/hegel";
 * import * as gs from "@hegeldev/hegel/generators";
 *
 * test("integer self equality", () =>
 *   hegel.test((tc) => {
 *     const n = tc.draw(gs.integers());
 *     if (n !== n) {
 *       throw new Error("integer was not equal to itself");
 *     }
 *   }));
 * ```
 *
 * Now run the test using `npx vitest run`. You should see that this test
 * passes.
 *
 * Let's look at what's happening in more detail. {@link test} runs your test
 * many times (100, by default). The test function receives a {@link TestCase},
 * which provides a {@link TestCase.draw | draw} method for drawing different
 * values. This test draws a random integer and checks that it should be equal
 * to itself.
 *
 * Next, try a test that fails:
 *
 * ```ts
 * test("integers always below 50", () =>
 *   hegel.test((tc) => {
 *     const n = tc.draw(gs.integers());
 *     if (n >= 50) {
 *       throw new Error(`n=${n} is too large`);
 *     }
 *   }));
 * ```
 *
 * This test asserts that any integer is less than 50, which is obviously
 * incorrect. Hegel will find a test case that makes this assertion fail, and
 * then shrink it to find the smallest counterexample — in this case, `n = 50`.
 *
 * To fix this test, you can constrain the integers you generate with the
 * `minValue` and `maxValue` options:
 *
 * ```ts
 * test("bounded integers always below 50", () =>
 *   hegel.test((tc) => {
 *     const n = tc.draw(gs.integers({ minValue: 0, maxValue: 49 }));
 *     if (n >= 50) {
 *       throw new Error(`n=${n} is too large`);
 *     }
 *   }));
 * ```
 *
 * Run the test again. It should now pass.
 *
 * ## Use generators
 *
 * Hegel provides a rich library of generators that you can use out of the box.
 * There are primitive generators, such as `integers`, `floats`, and `text`,
 * and combinators that allow you to make generators out of other generators,
 * such as `arrays` and `maps`.
 *
 * For example, you can use `arrays` to generate an array of integers:
 *
 * ```ts
 * test("append increases length", () =>
 *   hegel.test((tc) => {
 *     const xs = tc.draw(gs.arrays(gs.integers()));
 *     const initialLength = xs.length;
 *     xs.push(tc.draw(gs.integers()));
 *     if (xs.length <= initialLength) {
 *       throw new Error("length did not increase");
 *     }
 *   }));
 * ```
 *
 * This test checks that appending an element to a random array of integers
 * should always increase its length.
 *
 * You can also build composite values out of multiple generators. The simplest
 * way is to draw fields directly inside the test body:
 *
 * ```ts
 * interface Person {
 *   age: number;
 *   name: string;
 * }
 *
 * test("person", () =>
 *   hegel.test((tc) => {
 *     const person: Person = {
 *       age: tc.draw(gs.integers({ minValue: 0, maxValue: 120 })),
 *       name: tc.draw(gs.text({ minSize: 1, maxSize: 50 })),
 *     };
 *     // use person in your test
 *     void person;
 *   }));
 * ```
 *
 * For composite values you want to reuse across tests, build a generator with
 * `composite` (imperative — call `tc.draw()` on inner generators inside a
 * builder function) or `record` (declarative — pass a schema mapping field
 * names to generators). Both produce a generator that supports `.map()`,
 * `.filter()`, and `.flatMap()` like any other generator.
 *
 * ```ts
 * const personGen = gs.record({
 *   age: gs.integers({ minValue: 0, maxValue: 120 }),
 *   name: gs.text({ minSize: 1, maxSize: 50 }),
 * });
 *
 * test("person via record", () =>
 *   hegel.test((tc) => {
 *     const person = tc.draw(personGen);
 *     void person;
 *   }));
 * ```
 *
 * Note that you can feed the results of one `draw` into subsequent calls — this
 * is what `composite` is for. For example, say that you extend the `Person`
 * interface to include a `drivingLicense` boolean field, where the field
 * depends on `age`:
 *
 * ```ts
 * interface Person {
 *   age: number;
 *   name: string;
 *   drivingLicense: boolean;
 * }
 *
 * const personGen = gs.composite<Person>((tc) => {
 *   const age = tc.draw(gs.integers({ minValue: 0, maxValue: 120 }));
 *   const name = tc.draw(gs.text({ minSize: 1, maxSize: 50 }));
 *   const drivingLicense = age >= 18 ? tc.draw(gs.booleans()) : false;
 *   return { age, name, drivingLicense };
 * });
 * ```
 *
 * ## Debug your failing test cases
 *
 * Use the {@link TestCase.note | note} method to attach debug information:
 *
 * ```ts
 * test("addition is commutative", () =>
 *   hegel.test((tc) => {
 *     const x = tc.draw(gs.integers());
 *     const y = tc.draw(gs.integers());
 *     tc.note(`x + y = ${x + y}, y + x = ${y + x}`);
 *     if (x + y !== y + x) {
 *       throw new Error("addition is not commutative");
 *     }
 *   }));
 * ```
 *
 * Notes only appear when Hegel replays the minimal failing example.
 *
 * ## Change the number of test cases
 *
 * By default Hegel runs 100 test cases. To override this, pass a
 * {@link Settings} override as the second argument to {@link test}:
 *
 * ```ts
 * test("integers many", () =>
 *   hegel.test(
 *     (tc) => {
 *       const n = tc.draw(gs.integers());
 *       if (n !== n) {
 *         throw new Error("integer was not equal to itself");
 *       }
 *     },
 *     { testCases: 500 },
 *   ));
 * ```
 *
 * ## Learning more
 *
 * - Browse the `@hegeldev/hegel/generators` module for the full list of
 *   available generators.
 * - See {@link Settings} for more configuration settings to customize how
 *   your test runs.
 *
 * @packageDocumentation
 */

export * as generators from "./generators/index.js";
export { TestCase } from "./testCase.js";
export { test, testAsync, Verbosity, HealthCheck, Database } from "./runner.js";
export type { Settings } from "./runner.js";
