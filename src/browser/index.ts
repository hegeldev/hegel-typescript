import { createRunner } from "../runnerCore.js";
import { loadWasm } from "./load-wasm.js";
import { browserRuntime } from "./runtime.js";

const engine = await loadWasm(new URL("./libhegel-wasm32-unknown-unknown.wasm", import.meta.url));
const runner = createRunner(browserRuntime(engine));

export const test = runner.test;
export const testAsync = runner.testAsync;
export * as generators from "../generators/index.js";
export { TestCase } from "../testCase.js";
export { Verbosity, HealthCheck, Database } from "../runnerCore.js";
export type { Settings } from "../runnerCore.js";
