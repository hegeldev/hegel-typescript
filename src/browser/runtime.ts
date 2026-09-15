import type { Engine } from "../engine.js";
import { EngineError } from "../engine.js";
import { Database, Verbosity } from "../runnerCore.js";
import { portableDiagnostics, type RuntimeServices } from "../runtime.js";

export function browserRuntime(engine: Engine): RuntimeServices {
  return {
    ...portableDiagnostics,
    getEngine: () => engine,
    defaultSettings: () => ({
      testCases: 100,
      seed: null,
      verbosity: Verbosity.Normal,
      derandomize: false,
      database: Database.disabled,
      suppressHealthCheck: [],
      reportMultipleFailures: false,
    }),
    validateSettings(settings) {
      if (settings.database.kind === "path") {
        throw new EngineError("Filesystem databases are not supported in the browser");
      }
      if (settings.database.kind === "unset") settings.database = Database.disabled;
    },
    // Antithesis filesystem output is a Node-only service.
    emitAntithesisAssertion(_location, _passed) {},
  };
}
