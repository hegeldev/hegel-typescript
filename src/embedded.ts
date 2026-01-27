/**
 * Embedded mode implementation for Hegel TypeScript SDK.
 *
 * Creates a Unix socket server, spawns the hegel CLI in client mode,
 * and manages the test loop.
 */
import * as net from "node:net"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawn } from "node:child_process"
import { ensureHegel } from "./install.js"
import {
  setEmbeddedConnection,
  clearEmbeddedConnection,
  setIsLastRun,
} from "./connection.js"

export enum Verbosity {
  Quiet = "quiet",
  Normal = "normal",
  Verbose = "verbose",
  Debug = "debug",
}

/**
 * Special error thrown by assume() to signal test rejection.
 */
export class RejectError extends Error {
  constructor() {
    super("HEGEL_REJECT")
    this.name = "RejectError"
  }
}

/**
 * Builder class for configuring and running Hegel tests.
 */
export class Hegel {
  private testFn: () => void
  private _testCases: number = 100
  private _verbosity: Verbosity = Verbosity.Normal

  constructor(testFn: () => void) {
    this.testFn = testFn
  }

  /**
   * Set the number of test cases to run.
   */
  testCases(n: number): this {
    this._testCases = n
    return this
  }

  /**
   * Set the verbosity level.
   */
  verbosity(v: Verbosity): this {
    this._verbosity = v
    return this
  }

  /**
   * Run the test.
   */
  run(): Promise<void> {
    return runEmbedded(this.testFn, this._testCases, this._verbosity)
  }
}

/**
 * Simple wrapper for running a Hegel test with default options.
 */
export function hegel(testFn: () => void): Promise<void> {
  return new Hegel(testFn).run()
}

/**
 * Run embedded mode: create socket server, spawn hegel, handle connections.
 * Returns a Promise that resolves when all tests complete.
 */
function runEmbedded(
  testFn: () => void,
  testCases: number,
  verbosity: Verbosity,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const hegelPath = ensureHegel()

    // Create temp directory for socket
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hegel-ts-"))
    const socketPath = path.join(tmpDir, "hegel.sock")

    // Track exit code from hegel process
    let hegelExitCode = 0

    // Track cleanup state
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      try {
        fs.unlinkSync(socketPath)
      } catch {}
      try {
        fs.rmdirSync(tmpDir)
      } catch {}
    }

    // Create Unix socket server
    const server = net.createServer()
    server.listen(socketPath)

    // Spawn hegel in client mode
    const child = spawn(
      hegelPath,
      [
        "--client-mode",
        socketPath,
        "--test-cases",
        testCases.toString(),
        "--no-tui",
        "--verbosity",
        verbosity,
      ],
      {
        stdio: ["ignore", "inherit", "inherit"],
      },
    )

    child.on("exit", code => {
      if (verbosity === Verbosity.Debug) {
        console.error(`hegel-ts: hegel exited with code ${code}`)
      }
      hegelExitCode = code ?? 0
      server.close()
    })

    child.on("error", err => {
      console.error(`hegel-ts: failed to spawn hegel: ${err.message}`)
      cleanup()
      reject(new Error(`Failed to spawn hegel: ${err.message}`))
    })

    // Handle connections synchronously using a queue
    const connectionQueue: net.Socket[] = []
    let processing = false

    let connectionCount = 0
    server.on("connection", socket => {
      connectionCount++
      if (verbosity === Verbosity.Debug) {
        console.error(`hegel-ts: connection #${connectionCount} received`)
      }
      connectionQueue.push(socket)
      processQueue()
    })

    function processQueue() {
      if (processing || connectionQueue.length === 0) return
      processing = true

      const socket = connectionQueue.shift()!
      if (verbosity === Verbosity.Debug) {
        console.error(
          `hegel-ts: processing connection, queue size: ${connectionQueue.length}`,
        )
      }
      handleConnection(socket, testFn, verbosity)
        .catch(err => {
          console.error(`hegel-ts: connection error: ${err.message}`)
        })
        .finally(() => {
          if (verbosity === Verbosity.Debug) {
            console.error(`hegel-ts: connection complete`)
          }
          processing = false
          processQueue()
        })
    }

    server.on("close", () => {
      if (verbosity === Verbosity.Debug) {
        console.error("hegel-ts: server closed")
      }
      cleanup()
      if (hegelExitCode !== 0) {
        process.exit(hegelExitCode)
      }
      resolve()
    })
  })
}

/**
 * Handle a single connection from hegel (one test case).
 */
async function handleConnection(
  socket: net.Socket,
  testFn: () => void,
  verbosity: Verbosity,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ""

    const onData = (data: Buffer) => {
      buffer += data.toString()

      // Check for complete handshake message
      const newlineIndex = buffer.indexOf("\n")
      if (newlineIndex === -1) return

      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)

      socket.removeListener("data", onData)

      try {
        // Parse handshake
        const handshake = JSON.parse(line)
        const isLastRun = handshake.is_last_run ?? false

        if (verbosity === Verbosity.Debug) {
          console.error(`hegel-ts: handshake received: is_last_run=${isLastRun}`)
        }

        // Send acknowledgment
        socket.write(JSON.stringify({ type: "handshake_ack" }) + "\n")

        // Set up connection state for generators
        setIsLastRun(isLastRun)
        setEmbeddedConnection(socket, buffer)

        // Run test function
        let result: { type: string; result: string; message?: string }
        try {
          testFn()
          result = { type: "test_result", result: "pass" }
        } catch (err) {
          if (err instanceof RejectError) {
            result = { type: "test_result", result: "reject" }
          } else {
            const message = err instanceof Error ? err.message : String(err)
            result = { type: "test_result", result: "fail", message }

            // Print error details on last run
            if (isLastRun) {
              console.error(`\nTest failed: ${message}`)
              if (err instanceof Error && err.stack) {
                console.error(err.stack)
              }
            }
          }
        } finally {
          clearEmbeddedConnection()
        }

        if (verbosity === Verbosity.Debug) {
          console.error(`hegel-ts: sending result: ${JSON.stringify(result)}`)
        }

        // Send result
        socket.write(JSON.stringify(result) + "\n", () => {
          socket.end()
          resolve()
        })
      } catch (err) {
        socket.end()
        reject(err)
      }
    }

    socket.on("data", onData)
    socket.on("error", reject)
    socket.on("close", () => resolve())
  })
}
