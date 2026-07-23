import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import {
  libhegelPackageName,
  resolveLibrary,
  resolvePackagedBinary,
  locateLibhegel,
  LIBRARY_PATH_ENV,
} from "../src/locate.js";
import { LIBHEGEL_VERSION } from "../src/libhegel-version.js";
import { PLATFORMS } from "../scripts/fetch-libhegel.mjs";

const HOST_PLATFORM = process.platform;
const HOST_ARCH = process.arch;

// A supported platform that is never the host's, so its platform package can
// never be installed in this repo's node_modules (package managers skip
// optional dependencies whose os/cpu don't match).
const OTHER_PLATFORM: NodeJS.Platform = HOST_PLATFORM === "linux" ? "darwin" : "linux";

describe("libhegelPackageName", () => {
  it("maps each supported os/arch to a platform package", () => {
    expect(libhegelPackageName("linux", "x64")).toBe("@hegeldev/hegel-linux-x64");
    expect(libhegelPackageName("linux", "arm64")).toBe("@hegeldev/hegel-linux-arm64");
    expect(libhegelPackageName("darwin", "arm64")).toBe("@hegeldev/hegel-darwin-arm64");
    expect(libhegelPackageName("win32", "x64")).toBe("@hegeldev/hegel-win32-x64");
    expect(libhegelPackageName("win32", "arm64")).toBe("@hegeldev/hegel-win32-arm64");
  });

  it("throws for an unsupported platform", () => {
    expect(() => libhegelPackageName("freebsd" as NodeJS.Platform, "x64")).toThrow(
      /Unsupported platform/,
    );
  });

  it("throws for an unsupported architecture", () => {
    expect(() => libhegelPackageName("linux", "ia32")).toThrow(/Unsupported architecture/);
  });
});

describe("platform matrix consistency", () => {
  it("scripts, locate.ts, and package.json agree on the supported targets", () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      optionalDependencies: Record<string, string>;
    };
    // every scripts-side target passes locate.ts validation and is pinned as
    // an optionalDependency; no pins exist beyond the scripts-side targets.
    const names = PLATFORMS.map((p) => libhegelPackageName(p.platform, p.arch));
    expect(names.toSorted()).toEqual(Object.keys(pkg.optionalDependencies).toSorted());
  });
});

describe("resolvePackagedBinary", () => {
  it("resolves an installed specifier to a path", () => {
    expect(resolvePackagedBinary("koffi")).not.toBeNull();
  });

  it("returns null for an uninstalled package", () => {
    expect(resolvePackagedBinary("@hegeldev/not-a-real-package/binary")).toBeNull();
  });
});

describe("resolveLibrary", () => {
  it("returns the explicit override without consulting the platform package", () => {
    expect(
      resolveLibrary({
        env: { [LIBRARY_PATH_ENV]: "/opt/libhegel.so" },
        platform: HOST_PLATFORM,
        arch: HOST_ARCH,
      }),
    ).toBe("/opt/libhegel.so");
  });

  it("ignores an empty override", () => {
    expect(
      resolveLibrary({
        env: { [LIBRARY_PATH_ENV]: "" },
        platform: "linux",
        arch: "arm64",
        resolvePackaged: () => "/resolved/libhegel-linux-arm64.so",
      }),
    ).toBe("/resolved/libhegel-linux-arm64.so");
  });

  it("resolves the platform package's binary export", () => {
    const resolved: string[] = [];
    expect(
      resolveLibrary({
        env: {},
        platform: "linux",
        arch: "arm64",
        resolvePackaged: (specifier) => {
          resolved.push(specifier);
          return "/resolved/libhegel-linux-arm64.so";
        },
      }),
    ).toBe("/resolved/libhegel-linux-arm64.so");
    expect(resolved).toEqual(["@hegeldev/hegel-linux-arm64/binary"]);
  });

  it("throws when the platform package is not installed", () => {
    expect(() =>
      resolveLibrary({
        env: {},
        platform: HOST_PLATFORM,
        arch: HOST_ARCH,
        resolvePackaged: () => null,
      }),
    ).toThrow(/libhegel not found/);
  });

  it("uses the module system by default to find the platform package", () => {
    // OTHER_PLATFORM's package is never installed here, so the default
    // resolver comes up empty and resolution fails.
    expect(() => resolveLibrary({ env: {}, platform: OTHER_PLATFORM, arch: "arm64" })).toThrow(
      /libhegel not found/,
    );
  });

  it("propagates the unsupported-platform error before any lookup", () => {
    expect(() =>
      resolveLibrary({
        env: {},
        platform: "freebsd" as NodeJS.Platform,
        arch: HOST_ARCH,
      }),
    ).toThrow(/Unsupported platform/);
  });
});

describe("locateLibhegel", () => {
  const saved = process.env[LIBRARY_PATH_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[LIBRARY_PATH_ENV];
    else process.env[LIBRARY_PATH_ENV] = saved;
  });

  it("resolves via the process environment override", () => {
    process.env[LIBRARY_PATH_ENV] = "/tmp/some-libhegel.so";
    expect(locateLibhegel()).toBe("/tmp/some-libhegel.so");
  });
});

describe("libhegel-version module", () => {
  it("pins a semver libhegel version", () => {
    expect(LIBHEGEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
