import { Hegel, integers } from "../../../src/index.js"
import { getParams, getTestCases, write } from "./metrics.js"

interface Params {
  min_value: number | null
  max_value: number | null
}

const params = getParams<Params>()

new Hegel(() => {
  let gen = integers()
  if (params.min_value !== null) {
    gen = gen.min(params.min_value)
  }
  if (params.max_value !== null) {
    gen = gen.max(params.max_value)
  }

  const value = gen.generate()
  write({ value })
}).testCases(getTestCases()).run()
