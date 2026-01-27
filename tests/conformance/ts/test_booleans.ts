import { Hegel, booleans } from "../../../src/index.js"
import { getTestCases, write } from "./metrics.js"

new Hegel(() => {
  const value = booleans().generate()
  write({ value })
}).testCases(getTestCases()).run()
