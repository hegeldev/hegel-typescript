import { Hegel, maps, integers, text } from "../../../src/index.js"
import { getParams, getTestCases, write } from "./metrics.js"

interface Params {
  min_size: number
  max_size: number
  key_type: "string" | "integer"
  min_key: number
  max_key: number
  min_value: number
  max_value: number
}

const params = getParams<Params>()

await new Hegel(() => {
  // Value generator with bounds
  const valueGen = integers().min(params.min_value).max(params.max_value)

  let gen
  if (params.key_type === "string") {
    // String keys - use text generator
    gen = maps(text(), valueGen).minSize(params.min_size).maxSize(params.max_size)
  } else {
    // Integer keys - use integers with bounds
    // Note: TypeScript SDK maps() requires string keys, so we need to convert
    // For now, generate string representations of integers
    const keyGen = integers().min(params.min_key).max(params.max_key)
    gen = maps(keyGen.map(k => k.toString()), valueGen)
      .minSize(params.min_size)
      .maxSize(params.max_size)
  }

  const value = gen.generate()
  const entries = [...value.entries()]

  const metrics: Record<string, number> = { size: entries.length }
  if (entries.length > 0) {
    const values = entries.map(([_, v]) => v)
    metrics.min_value = Math.min(...values)
    metrics.max_value = Math.max(...values)

    if (params.key_type === "integer") {
      const keys = entries.map(([k, _]) => parseInt(k, 10))
      metrics.min_key = Math.min(...keys)
      metrics.max_key = Math.max(...keys)
    }
  }
  write(metrics)
}).testCases(getTestCases()).run()
