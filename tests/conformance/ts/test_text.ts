import { Hegel, text } from "../../../src/index.js"
import { getParams, getTestCases, write } from "./metrics.js"

interface Params {
  min_size: number
  max_size: number | null
}

const params = getParams<Params>()

await new Hegel(() => {
  let gen = text().minSize(params.min_size)
  if (params.max_size !== null) {
    gen = gen.maxSize(params.max_size)
  }

  const value = gen.generate()
  // Length in Unicode codepoints, not UTF-16 code units
  const length = [...value].length
  write({ length })
}).testCases(getTestCases()).run()
