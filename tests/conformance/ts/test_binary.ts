import { Hegel, binary } from "../../../src/index.js"
import { getParams, getTestCases, write } from "./metrics.js"

interface Params {
  min_size: number
  max_size: number | null
}

const params = getParams<Params>()

new Hegel(() => {
  let gen = binary({ minSize: params.min_size })
  if (params.max_size !== null) {
    gen = binary({ minSize: params.min_size, maxSize: params.max_size })
  }

  const value = gen.generate()
  write({ length: value.length })
}).testCases(getTestCases()).run()
