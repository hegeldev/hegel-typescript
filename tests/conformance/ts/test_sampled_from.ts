import { Hegel, sampledFrom } from "../../../src/index.js"
import { getParams, getTestCases, write } from "./metrics.js"

interface Params {
  options: number[]
}

const params = getParams<Params>()

new Hegel(() => {
  const value = sampledFrom(params.options).generate()
  write({ value })
}).testCases(getTestCases()).run()
