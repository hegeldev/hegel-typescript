import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedVersion, releaseTag } from "./fetch-libhegel.mjs";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PIN = JSON.parse(
  fs.readFileSync(new URL("../src/browser/artifact.json", import.meta.url)),
);
export const PREPARED = path.join(ROOT, "native", "wasm", PIN.sha256, PIN.asset);
const REPO = "hegeldev/hegel-rust";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", ...options });

export function verifyBytes(bytes, pin = PIN) {
  if (sha256(bytes) !== pin.sha256) throw new Error("Wasm checksum differs from the audited pin");
  if (!WebAssembly.validate(bytes)) throw new Error("Invalid Wasm artifact");
}

export function requirePublished(pin = PIN) {
  if (
    pin.published !== true ||
    pin.release?.tag !== releaseTag(pin.version) ||
    !/^[a-f0-9]{40}$/.test(pin.source)
  ) {
    throw new Error(
      "Publication blocked: pin a merged, published Wasm release, not a development artifact",
    );
  }
}

export function verifyProvenance(receipt, pin = PIN) {
  if (
    receipt.pinSha256 !== sha256(JSON.stringify(pin)) ||
    receipt.sha256 !== pin.sha256 ||
    receipt.mode !== (pin.published ? "release" : "development")
  ) {
    throw new Error(
      "Wasm preparation provenance is missing or stale; prepare the pinned artifact explicitly",
    );
  }
}

function save(bytes, mode, evidence) {
  verifyBytes(bytes);
  fs.mkdirSync(path.dirname(PREPARED), { recursive: true });
  fs.writeFileSync(PREPARED, bytes);
  fs.writeFileSync(
    `${PREPARED}.json`,
    JSON.stringify(
      {
        mode,
        sha256: PIN.sha256,
        pinSha256: sha256(JSON.stringify(PIN)),
        ...evidence,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(`${PREPARED}\n`);
}

export function preparedBytes() {
  if (PIN.version !== pinnedVersion()) throw new Error("Native and Wasm version pins differ");
  const bytes = fs.readFileSync(PREPARED);
  verifyBytes(bytes);
  verifyProvenance(JSON.parse(fs.readFileSync(`${PREPARED}.json`)));
  return bytes;
}

async function development(repo, twice) {
  if (!repo || PIN.published)
    throw new Error("Usage: prepare:wasm -- dev /path/to/hegel-rust [--verify-reproducible]");
  repo = fs.realpathSync(repo);
  // Published pins (written by scripts/update-libhegel.mjs) carry only what
  // the release itself attests to; a development pin must also record the
  // toolchain and lockfile that its reproducible build is checked against.
  for (const field of ["rustc", "rustcCommit", "cargo", "cargoLockSha256"]) {
    if (typeof PIN[field] !== "string") {
      throw new Error(`Development preparation needs ${field} in src/browser/artifact.json`);
    }
  }
  const compiler = run("rustc", [`+${PIN.rustc}`, "-vV"]);
  if (
    !compiler.includes(`commit-hash: ${PIN.rustcCommit}\n`) ||
    !compiler.includes(`release: ${PIN.rustc}\n`) ||
    !run("cargo", [`+${PIN.rustc}`, "-V"]).startsWith(`cargo ${PIN.cargo} `)
  ) {
    throw new Error("Install the exact pinned Rust/Cargo toolchain before development preparation");
  }
  const hashes = [];
  let bytes;
  for (let i = 0; i < (twice ? 2 : 1); i++) {
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hegel-wasm-build-")));
    try {
      const source = path.join(temp, `source-${i}`);
      const cargoHome = path.join(temp, `cargo-${i}`);
      const target = path.join(temp, `target-${i}`);
      fs.mkdirSync(source);
      const archive = execFileSync("git", ["-C", repo, "archive", PIN.source], {
        maxBuffer: 64 * 1024 * 1024,
      });
      execFileSync("tar", ["-x", "-C", source], { input: archive });
      if (sha256(fs.readFileSync(path.join(source, "Cargo.lock"))) !== PIN.cargoLockSha256) {
        throw new Error("Pinned Rust source has an unexpected Cargo.lock");
      }
      const env = { ...process.env, CARGO_HOME: cargoHome };
      for (const key of Object.keys(env)) {
        if (
          key.startsWith("CARGO_BUILD_") ||
          key.startsWith("CARGO_PROFILE_") ||
          key.startsWith("CARGO_TARGET_") ||
          [
            "RUSTFLAGS",
            "CARGO_ENCODED_RUSTFLAGS",
            "RUSTC",
            "RUSTC_WRAPPER",
            "RUSTC_WORKSPACE_WRAPPER",
          ].includes(key)
        )
          delete env[key];
      }
      env.CARGO_ENCODED_RUSTFLAGS = [
        [source, "/hegel/source"],
        [cargoHome, "/hegel/cargo"],
        [target, "/hegel/target"],
      ]
        .map(([from, to]) => `--remap-path-prefix=${from}=${to}`)
        .join("\u001f");
      run(
        "cargo",
        [
          `+${PIN.rustc}`,
          "build",
          "--manifest-path",
          path.join(source, "Cargo.toml"),
          "-p",
          "hegeltest-c",
          "--release",
          "--locked",
          "--target",
          PIN.target,
          "--target-dir",
          target,
        ],
        { cwd: source, env, stdio: ["ignore", "inherit", "inherit"] },
      );
      bytes = fs.readFileSync(path.join(target, PIN.target, "release", "hegel_c.wasm"));
      verifyBytes(bytes);
      hashes.push(sha256(bytes));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  save(bytes, "development", { source: PIN.source, compiler, builds: hashes, remappedPaths: true });
}

const gh = (...args) => JSON.parse(run("gh", args));

/** The commit a release tag points at (through any annotated tag objects). */
export function tagCommit(tag) {
  let object = gh("api", `repos/${REPO}/git/ref/tags/${tag}`).object;
  while (object.type === "tag") object = gh("api", `repos/${REPO}/git/tags/${object.sha}`).object;
  if (object.type !== "commit") throw new Error(`Tag ${tag} does not resolve to a commit`);
  return object.sha;
}

export async function prepareRelease() {
  requirePublished();
  const rel = gh(
    "release",
    "view",
    PIN.release.tag,
    "--repo",
    REPO,
    "--json",
    "tagName,assets,isDraft,isPrerelease",
  );
  if (rel.isDraft || rel.isPrerelease || rel.tagName !== PIN.release.tag)
    throw new Error("Not a stable published release");
  const source = tagCommit(PIN.release.tag);
  if (source !== PIN.source) throw new Error("Release tag does not match the pinned source");
  // The full comparison payload lists every commit and file changed since the
  // release and outgrows execFileSync's default buffer; only its status matters.
  // (`--jq` prints the selected string raw, without JSON quotes.)
  const status = run("gh", [
    "api",
    `repos/${REPO}/compare/${PIN.source}...main`,
    "--jq",
    ".status",
  ]).trim();
  if (!["ahead", "identical"].includes(status))
    throw new Error("Release source is not merged into upstream main");
  for (const name of [PIN.asset, `${PIN.asset}.sha256`]) {
    if (!rel.assets.some((a) => a.name === name)) throw new Error(`Release is missing ${name}`);
  }
  const base = `https://github.com/${REPO}/releases/download/${PIN.release.tag}/`;
  const download = async (name) => {
    const response = await fetch(base + name);
    if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${name}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const checksum = (await download(`${PIN.asset}.sha256`)).toString("utf8").trim();
  if (
    !new RegExp(`^${PIN.sha256}(?:\\s+\\*?${PIN.asset.replaceAll(".", "\\.")})?$`).test(checksum)
  ) {
    throw new Error("Published checksum sidecar differs from the pin");
  }
  save(await download(PIN.asset), "release", { source, tag: rel.tagName, merged: true });
}

export async function main(args = process.argv.slice(2)) {
  const [mode, repo, flag] = args;
  if (mode === "dev") {
    if (args.length > 3 || (flag !== undefined && flag !== "--verify-reproducible")) {
      throw new Error("Unknown development preparation argument");
    }
    return development(repo, flag === "--verify-reproducible");
  }
  if (mode === "release") {
    requirePublished();
    if (PIN.version !== pinnedVersion()) throw new Error("Native and Wasm version pins differ");
    return prepareRelease();
  }
  if (mode === "publish-check") {
    requirePublished();
    const bytes = preparedBytes();
    const packaged = fs.readFileSync(path.join(ROOT, "dist/browser", PIN.asset));
    if (!bytes.equals(packaged)) throw new Error("Packaged Wasm differs from the prepared release");
    return;
  }
  if (mode === "copy") {
    const bytes = preparedBytes();
    const dest = path.join(ROOT, "dist/browser", PIN.asset);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    fs.rmSync(`${dest}.provenance.json`, { force: true });
    return;
  }
  throw new Error(
    "Choose dev <Rust checkout> [--verify-reproducible], release, copy, or publish-check",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
