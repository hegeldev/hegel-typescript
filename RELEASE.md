RELEASE_TYPE: patch

The native libhegel shared libraries are now distributed as per-platform npm
packages (`@hegeldev/hegel-linux-x64`, `@hegeldev/hegel-darwin-arm64`, ...)
instead of all being bundled inside the main package. Your package manager
automatically installs the single package matching your platform. No action is
required.
