/** Node composition root. The browser entry composes runnerCore with its own runtime. */
import { createRunner } from "./runnerCore.js";
import { nodeRuntime } from "./nodeRuntime.js";

export {
  Verbosity,
  HealthCheck,
  Database,
  EngineDataSource as NativeDataSource,
  runTestCase,
  runTestCaseAsync,
} from "./runnerCore.js";
export type { Settings, TestLocation, TestCaseResult } from "./runnerCore.js";
export { defaultSettings } from "./nodeRuntime.js";
const runner = createRunner(nodeRuntime);
export const { test, testAsync, Hegel } = runner;
export type Hegel = InstanceType<typeof Hegel>;
