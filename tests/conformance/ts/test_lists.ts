import { Hegel, arrays, integers } from "../../../src/index.js"
import { getParams, getTestCases, write } from "./metrics.js"

interface Params {
  min_size: number
  max_size: number | null
  min_value: number | null
  max_value: number | null
}

const params = getParams<Params>()

new Hegel(() => {
  let elemGen = integers()
  if (params.min_value !== null) {
    elemGen = elemGen.min(params.min_value)
  }
  if (params.max_value !== null) {
    elemGen = elemGen.max(params.max_value)
  }

  let gen = arrays(elemGen).minSize(params.min_size)
  if (params.max_size !== null) {
    gen = gen.maxSize(params.max_size)
  }

  const value = gen.generate()
  const metrics: Record<string, number> = { size: value.length }
  if (value.length > 0) {
    metrics.min_element = Math.min(...value)
    metrics.max_element = Math.max(...value)
  }
  write(metrics)
}).testCases(getTestCases()).run()
