import type { Engine } from "./engine.js";
import type { Settings, TestLocation } from "./runnerCore.js";

export interface Diagnostics {
  reportFinalValue(value: unknown, drawNumber: number): void;
  reportFinalError(error: unknown): void;
  note(message: string): void;
}

/** Only host services used by the shared run loop. */
export interface RuntimeServices extends Diagnostics {
  getEngine(): Engine;
  defaultSettings(): Settings;
  validateSettings(settings: Settings): void;
  emitAntithesisAssertion(location: TestLocation, passed: boolean): void;
}

export const portableDiagnostics: Diagnostics = {
  reportFinalValue(value, drawNumber) {
    console.error(`var draw_${drawNumber} =`, value);
  },
  reportFinalError(error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
  },
  note(message) {
    console.error(message);
  },
};
