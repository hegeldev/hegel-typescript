import { Hegel, floats } from "../../../src/index.js"
import { getParams, getTestCases, write } from "./metrics.js"

interface Params {
  min_value: number | null
  max_value: number | null
  exclude_min: boolean
  exclude_max: boolean
  allow_nan: boolean
  allow_infinity: boolean
}

const params = getParams<Params>()

await new Hegel(() => {
  let gen = floats()
  if (params.min_value !== null) {
    gen = gen.min(params.min_value)
  }
  if (params.max_value !== null) {
    gen = gen.max(params.max_value)
  }
  if (params.exclude_min) {
    gen = gen.excludeMin()
  }
  if (params.exclude_max) {
    gen = gen.excludeMax()
  }
  if (params.allow_nan) {
    gen = gen.allowNan()
  }
  if (params.allow_infinity) {
    gen = gen.allowInfinity()
  }

  const value = gen.generate()
  write({
    value: Number.isNaN(value) ? 0 : value,
    is_nan: Number.isNaN(value),
    is_infinite: !Number.isFinite(value) && !Number.isNaN(value),
  })
}).testCases(getTestCases()).run()
