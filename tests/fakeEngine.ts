import { vi } from "vitest";
import {
  RunStatus,
  type Engine,
  type ContextHandle,
  type SettingsHandle,
  type RunHandle,
  type RunResultHandle,
  type TestCaseHandle,
  type FailureHandle,
  type CollectionHandle,
  type StringGeneratorHandle,
  type PoolHandle,
  type StateMachineHandle,
} from "../src/engine.js";
import { Database, Verbosity } from "../src/runnerCore.js";
import type { RuntimeServices } from "../src/runtime.js";

export const context = {} as ContextHandle;
export const settings = {} as SettingsHandle;
export const run = {} as RunHandle;
export const result = {} as RunResultHandle;
export const testCase = {} as TestCaseHandle;
export const replayCase = {} as TestCaseHandle;
export const failure = {} as FailureHandle;
export const collection = {} as CollectionHandle;
export const stringGenerator = {} as StringGeneratorHandle;
export const pool = {} as PoolHandle;
export const stateMachine = {} as StateMachineHandle;

/** Deterministic Engine double; no ABI pointers or generated engine logic. */
export function fakeEngine() {
  return {
    version: vi.fn<Engine["version"]>(() => "0.42.4"),
    newContext: vi.fn<Engine["newContext"]>(() => context),
    freeContext: vi.fn<Engine["freeContext"]>(),
    lastError: vi.fn<Engine["lastError"]>(() => "diagnostic"),
    newSettings: vi.fn<Engine["newSettings"]>(() => settings),
    freeSettings: vi.fn<Engine["freeSettings"]>(),
    setTestCases: vi.fn<Engine["setTestCases"]>(),
    setVerbosity: vi.fn<Engine["setVerbosity"]>(),
    setSeed: vi.fn<Engine["setSeed"]>(),
    setDerandomize: vi.fn<Engine["setDerandomize"]>(),
    setDatabase: vi.fn<Engine["setDatabase"]>(),
    setDatabaseKey: vi.fn<Engine["setDatabaseKey"]>(),
    setSuppressHealthCheck: vi.fn<Engine["setSuppressHealthCheck"]>(),
    setReportMultipleFailures: vi.fn<Engine["setReportMultipleFailures"]>(),
    runStart: vi.fn<Engine["runStart"]>(() => run),
    nextTestCase: vi
      .fn<Engine["nextTestCase"]>()
      .mockReturnValueOnce(testCase)
      .mockReturnValue(null),
    runResult: vi.fn<Engine["runResult"]>(() => result),
    freeRunResult: vi.fn<Engine["freeRunResult"]>(),
    freeRun: vi.fn<Engine["freeRun"]>(),
    testCaseFromBlob: vi.fn<Engine["testCaseFromBlob"]>(() => replayCase),
    freeTestCase: vi.fn<Engine["freeTestCase"]>(),
    generateBoolean: vi.fn<Engine["generateBoolean"]>(() => true),
    generateInteger: vi.fn<Engine["generateInteger"]>(() => 0n),
    generateIntegerBig: vi.fn<Engine["generateIntegerBig"]>(() => 0n),
    generateFloat: vi.fn<Engine["generateFloat"]>(() => 1),
    generateBytes: vi.fn<Engine["generateBytes"]>(() => new Uint8Array([0, 255])),
    stringGeneratorText: vi.fn<Engine["stringGeneratorText"]>(() => stringGenerator),
    stringGeneratorRegex: vi.fn<Engine["stringGeneratorRegex"]>(() => stringGenerator),
    stringGeneratorEmail: vi.fn<Engine["stringGeneratorEmail"]>(() => stringGenerator),
    stringGeneratorUrl: vi.fn<Engine["stringGeneratorUrl"]>(() => stringGenerator),
    stringGeneratorDomain: vi.fn<Engine["stringGeneratorDomain"]>(() => stringGenerator),
    generateString: vi.fn<Engine["generateString"]>(() => "value"),
    generateDate: vi.fn<Engine["generateDate"]>(() => ({ year: 2024, month: 2, day: 29 })),
    generateTime: vi.fn<Engine["generateTime"]>(() => ({
      hour: 1,
      minute: 2,
      second: 3,
      nanosecond: 1,
    })),
    generateDatetime: vi.fn<Engine["generateDatetime"]>(() => ({
      date: { year: 2024, month: 2, day: 29 },
      time: { hour: 1, minute: 2, second: 3, nanosecond: 1 },
    })),
    generateUuid: vi.fn<Engine["generateUuid"]>(() =>
      Uint8Array.from([
        0xa7, 0x0f, 0x44, 0x6c, 0x05, 0xe3, 0x42, 0xa9, 0xa3, 0x1b, 0xf0, 0xd0, 0x54, 0x5d, 0x63,
        0x16,
      ]),
    ),
    generateIpv4: vi.fn<Engine["generateIpv4"]>(() => new Uint8Array([127, 0, 0, 1])),
    generateIpv6: vi.fn<Engine["generateIpv6"]>(() => new Uint8Array(16)),
    startSpan: vi.fn<Engine["startSpan"]>(),
    stopSpan: vi.fn<Engine["stopSpan"]>(),
    newCollection: vi.fn<Engine["newCollection"]>(() => collection),
    collectionMore: vi
      .fn<Engine["collectionMore"]>()
      .mockReturnValueOnce(true)
      .mockReturnValue(false),
    collectionReject: vi.fn<Engine["collectionReject"]>(),
    freeCollection: vi.fn<Engine["freeCollection"]>(),
    markComplete: vi.fn<Engine["markComplete"]>(),
    newPool: vi.fn<Engine["newPool"]>(() => pool),
    poolAdd: vi.fn<Engine["poolAdd"]>(() => 0n),
    poolGenerate: vi.fn<Engine["poolGenerate"]>(() => 0n),
    freePool: vi.fn<Engine["freePool"]>(),
    newStateMachine: vi.fn<Engine["newStateMachine"]>(() => stateMachine),
    stateMachineNextGroup: vi
      .fn<Engine["stateMachineNextGroup"]>()
      .mockReturnValueOnce(0)
      .mockReturnValue(null),
    stateMachineNextRule: vi
      .fn<Engine["stateMachineNextRule"]>()
      .mockReturnValueOnce(0)
      .mockReturnValue(null),
    stateMachineRuleRejected: vi.fn<Engine["stateMachineRuleRejected"]>(),
    stateMachineShouldCheckInvariant: vi.fn<Engine["stateMachineShouldCheckInvariant"]>(() => true),
    freeStateMachine: vi.fn<Engine["freeStateMachine"]>(),
    runStatus: vi.fn<Engine["runStatus"]>(() => RunStatus.PASSED),
    runError: vi.fn<Engine["runError"]>(() => "backend error"),
    failureCount: vi.fn<Engine["failureCount"]>(() => 1),
    failure: vi.fn<Engine["failure"]>(() => failure),
    freeFailure: vi.fn<Engine["freeFailure"]>(),
    failureOrigin: vi.fn<Engine["failureOrigin"]>(() => "property.ts:1"),
    reproductionBlob: vi.fn<Engine["reproductionBlob"]>(() => "blob"),
    freeStringGenerator: vi.fn<Engine["freeStringGenerator"]>(),
  } satisfies Engine;
}

export function fakeRuntime(engine: Engine): RuntimeServices {
  return {
    getEngine: () => engine,
    defaultSettings: () => ({
      testCases: 100,
      seed: null,
      verbosity: Verbosity.Normal,
      derandomize: true,
      database: Database.disabled,
      suppressHealthCheck: [],
      reportMultipleFailures: false,
    }),
    validateSettings: vi.fn(),
    reportFinalValue: vi.fn(),
    reportFinalError: vi.fn(),
    note: vi.fn(),
    emitAntithesisAssertion: vi.fn(),
  };
}
