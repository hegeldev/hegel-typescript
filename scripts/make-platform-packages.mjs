// Assembles the per-platform npm packages (@hegeldev/hegel-<os>-<arch>) into
// `platform-packages/`. Each package contains a single libhegel shared library
// plus a manifest whose `os`/`cpu` fields let package managers install only the
// host's package (they are `optionalDependencies` of the main package).
//
// Artifacts are fetched from the pinned hegel-rust release (see
// scripts/fetch-libhegel.mjs). Package versions are read from the root
// package.json — the release pipeline bumps that first, then runs this script
// and publishes each generated directory (see .github/scripts/release.py).
//
// Usage:
//   node scripts/make-platform-packages.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS, fetchAsset, pinnedVersion } from "./fetch-libhegel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "platform-packages");

const OS_LABELS = { darwin: "macOS", linux: "Linux", win32: "Windows" };
const CPU_LABELS = { x64: "64-bit", arm64: "ARM 64-bit" };

// Package names use Node's platform/arch vocabulary (win32, x64) per ecosystem
// convention; the artifact filename keeps the release's Go-style tokens
// (windows, amd64), bridged by the "./binary" export.
function packageJson({ platform, arch, asset }, { version, engines, repository, license }) {
  return {
    name: `@hegeldev/hegel-${platform}-${arch}`,
    version,
    description:
      `The ${OS_LABELS[platform]} ${CPU_LABELS[arch]} native library for ` +
      `@hegeldev/hegel, a property-based testing library for TypeScript.`,
    repository,
    license,
    // preferUnplugged is for yarn pnp, which uses zi pfiles by default, which fable
    // thinks won't work with koffi
    preferUnplugged: true,
    engines,
    os: [platform],
    cpu: [arch],
    exports: {
      "./binary": `./${asset}`,
    },
    publishConfig: {
      access: "public",
      provenance: true,
    },
  };
}

async function main() {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const libhegelVersion = pinnedVersion();

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  for (const target of PLATFORMS) {
    const artifact = await fetchAsset(target.asset, libhegelVersion);
    const manifest = packageJson(target, root);
    // weld the generated name/version to the main package's exact pins, so a
    // drift in the naming scheme or a missed pin bump fails loudly here
    // instead of publishing packages the resolver won't find.
    const pinned = root.optionalDependencies?.[manifest.name];
    if (pinned !== manifest.version) {
      throw new Error(
        `${manifest.name}@${manifest.version} is pinned as ${pinned} in package.json ` +
          `optionalDependencies — names and versions must match exactly`,
      );
    }
    const pkgDir = path.join(OUT_DIR, manifest.name.replace("@hegeldev/", ""));
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.copyFileSync(artifact, path.join(pkgDir, target.asset));
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message ?? err}\n`);
  process.exit(1);
});
