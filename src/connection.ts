/**
 * Connection management for Hegel SDK (embedded mode).
 *
 * The embedded mode handler (embedded.ts) sets up the socket connection
 * for each test case and provides it to this module.
 */
import * as net from "node:net"
import * as fs from "node:fs"
import { RejectError } from "./embedded.js"

/**
 * Module-level state.
 */
let embeddedSocket: net.Socket | null = null
let socketFd: number | null = null
let socketBuffer = ""
let requestId = 0
let spanDepth = 0
let isLastRun = false

const DEBUG = process.env.HEGEL_DEBUG === "1" || process.env.HEGEL_DEBUG === "true"

function debug(msg: string): void {
  if (DEBUG) {
    console.error(`[ts-sdk] ${msg}`)
  }
}

/**
 * Set the embedded socket connection (called by embedded.ts for each test case).
 */
export function setEmbeddedConnection(socket: net.Socket, initialBuffer = ""): void {
  embeddedSocket = socket
  socketBuffer = initialBuffer
  requestId = 0
  spanDepth = 0
  // Get the underlying file descriptor for synchronous I/O
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (socket as any)._handle
  socketFd = handle?.fd ?? null
}

/**
 * Clear the embedded socket connection (called by embedded.ts after test case).
 */
export function clearEmbeddedConnection(): void {
  embeddedSocket = null
  socketFd = null
  socketBuffer = ""
}

/**
 * Set the is_last_run flag (called by embedded.ts).
 */
export function setIsLastRun(value: boolean): void {
  isLastRun = value
}

/**
 * Assume a condition is true. If false, reject the current test case.
 * This signals to Hegel that the input is invalid, not a test failure.
 */
export function assume(condition: boolean): void {
  if (!condition) {
    throw new RejectError()
  }
}

/**
 * Print a note for debugging. Only visible on the final replay run.
 */
export function note(message: string): void {
  if (isLastRun) {
    console.error(message)
  }
}

/**
 * Increment span depth.
 */
export function incrementSpanDepth(): void {
  spanDepth++
}

/**
 * Decrement span depth.
 */
export function decrementSpanDepth(): void {
  spanDepth--
}

/**
 * Convert special object wrappers from the server to native JS values.
 * Handles:
 * - {"$float": "nan"} -> NaN
 * - {"$float": "inf"} -> Infinity
 * - {"$float": "-inf"} -> -Infinity
 * - {"$integer": "..."} -> BigInt (or number if it fits)
 */
function convertSpecialValues(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(convertSpecialValues)
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)

    // Check for special single-key objects
    if (keys.length === 1) {
      if (keys[0] === "$float" && typeof obj["$float"] === "string") {
        switch (obj["$float"]) {
          case "nan":
            return NaN
          case "inf":
            return Infinity
          case "-inf":
            return -Infinity
        }
      }
      if (keys[0] === "$integer" && typeof obj["$integer"] === "string") {
        // Return as number (BigInt not commonly used in JS APIs)
        return Number(obj["$integer"])
      }
    }

    // Recursively convert object values
    const result: Record<string, unknown> = {}
    for (const key of keys) {
      result[key] = convertSpecialValues(obj[key])
    }
    return result
  }

  return value
}

/**
 * Send a request to the Hegel server and wait for a response.
 * This is synchronous from the caller's perspective.
 */
export function sendRequest(
  command: string,
  payload: unknown,
): { result?: unknown; error?: string } {
  if (!embeddedSocket) {
    throw new Error("hegel: not connected to socket")
  }

  const id = ++requestId
  const request = { id, command, payload }
  const requestJson = JSON.stringify(request)

  debug(`REQUEST: ${requestJson}`)

  // Write request synchronously
  embeddedSocket.write(requestJson + "\n")

  // Read response - this needs to be synchronous
  // We use the Atomics-based sync pattern or deasync
  const responseStr = readLineSync()

  debug(`RESPONSE: ${responseStr}`)

  let response: { id: number; result?: unknown; error?: string }
  try {
    response = JSON.parse(responseStr)
  } catch (err) {
    throw new Error(
      `hegel: failed to parse server response as JSON: ${err}\nResponse: ${responseStr}`,
    )
  }

  if (response.error) {
    throw new Error(`hegel: server returned error: ${response.error}`)
  }
  if (response.id !== id) {
    throw new Error(`hegel: response ID mismatch: expected ${id}, got ${response.id}`)
  }

  return response
}

/**
 * Synchronously read a line from the socket.
 * Uses fs.readSync on the socket's file descriptor for true blocking I/O.
 */
function readLineSync(): string {
  if (!embeddedSocket) {
    throw new Error("hegel: not connected to socket")
  }

  // Check buffer first
  let newlineIndex = socketBuffer.indexOf("\n")
  if (newlineIndex !== -1) {
    const line = socketBuffer.slice(0, newlineIndex)
    socketBuffer = socketBuffer.slice(newlineIndex + 1)
    return line
  }

  if (socketFd === null) {
    throw new Error("hegel: socket file descriptor not available")
  }

  // Use fs.readSync for true blocking I/O
  const readBuffer = Buffer.alloc(4096)
  const startTime = Date.now()
  const timeout = 30000 // 30 second timeout

  while (true) {
    try {
      const bytesRead = fs.readSync(socketFd, readBuffer, 0, readBuffer.length, null)
      if (bytesRead > 0) {
        socketBuffer += readBuffer.subarray(0, bytesRead).toString()
        newlineIndex = socketBuffer.indexOf("\n")
        if (newlineIndex !== -1) {
          const line = socketBuffer.slice(0, newlineIndex)
          socketBuffer = socketBuffer.slice(newlineIndex + 1)
          return line
        }
      } else if (bytesRead === 0) {
        // EOF - socket closed
        throw new Error("hegel: socket closed while reading")
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") {
        // Non-blocking socket would block - wait a bit and retry
        const sharedBuffer = new SharedArrayBuffer(4)
        const int32 = new Int32Array(sharedBuffer)
        Atomics.wait(int32, 0, 0, 1) // Wait 1ms
      } else {
        throw err
      }
    }

    // Check timeout
    if (Date.now() - startTime > timeout) {
      throw new Error("hegel: timeout waiting for response")
    }
  }
}

/**
 * Generate a value from a JSON schema.
 */
export function generateFromSchema<T>(schema: Record<string, unknown>): T {
  const response = sendRequest("generate", schema)

  // Note: sendRequest already validates response.error, so this is defensive
  if (response.error) {
    throw new Error(`hegel: server returned error: ${response.error}`)
  }

  return convertSpecialValues(response.result) as T
}
