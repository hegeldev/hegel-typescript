/**
 * Hegel binary discovery and installation.
 *
 * Same logic as Rust's build.rs - finds hegel on PATH or auto-installs via uv.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"

const CACHE_DIR = path.join(os.homedir(), ".cache", "hegel-ts")
const VENV_PATH = path.join(CACHE_DIR, "venv")
const HEGEL_PATH = path.join(VENV_PATH, "bin", "hegel")
const UV_PATH = path.join(CACHE_DIR, "uv")

let cachedHegelPath: string | null = null

/**
 * Find an executable on PATH.
 */
function findOnPath(name: string): string | null {
  const pathEnv = process.env.PATH
  if (!pathEnv) return null

  const paths = pathEnv.split(path.delimiter)
  for (const dir of paths) {
    const fullPath = path.join(dir, name)
    try {
      fs.accessSync(fullPath, fs.constants.X_OK)
      return fullPath
    } catch {
      // Not found or not executable
    }
  }
  return null
}

/**
 * Ensure uv is available, installing if necessary.
 */
function ensureUv(): string {
  // Check PATH first
  const pathUv = findOnPath("uv")
  if (pathUv) {
    return pathUv
  }

  // Check cache
  if (fs.existsSync(UV_PATH)) {
    return UV_PATH
  }

  // Install uv
  console.error("hegel-ts: installing uv...")
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  execSync(
    `curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=${CACHE_DIR} sh`,
    { stdio: "inherit", shell: "/bin/sh" },
  )

  if (!fs.existsSync(UV_PATH)) {
    throw new Error(`uv not found at ${UV_PATH} after installation`)
  }

  return UV_PATH
}

/**
 * Ensure hegel is available, installing if necessary.
 * Returns the path to the hegel binary.
 */
export function ensureHegel(): string {
  if (cachedHegelPath) return cachedHegelPath

  // 1. Check PATH
  const pathHegel = findOnPath("hegel")
  if (pathHegel) {
    cachedHegelPath = pathHegel
    return pathHegel
  }

  // 2. Check cache
  if (fs.existsSync(HEGEL_PATH)) {
    cachedHegelPath = HEGEL_PATH
    return HEGEL_PATH
  }

  // 3. Install
  console.error("hegel-ts: hegel not found, installing...")
  const uvPath = ensureUv()

  console.error("hegel-ts: creating venv...")
  execSync(`"${uvPath}" venv --python 3.13 "${VENV_PATH}"`, {
    stdio: "inherit",
    shell: "/bin/sh",
  })

  console.error("hegel-ts: installing hegel...")
  execSync(
    `"${uvPath}" pip install git+ssh://git@github.com/antithesishq/hegel.git --python "${VENV_PATH}/bin/python"`,
    { stdio: "inherit", shell: "/bin/sh" },
  )

  if (!fs.existsSync(HEGEL_PATH)) {
    throw new Error(`hegel not found at ${HEGEL_PATH} after installation`)
  }

  cachedHegelPath = HEGEL_PATH
  return HEGEL_PATH
}
