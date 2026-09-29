# Third-party notices

This file records the bundled helper tools examined for this repository. The crowline source itself is licensed under the [MIT License](LICENSE).

`pnpm tools:prepare` builds the helper-tool bundle from the pinned sources in `tools-lock.json`. It verifies the GitHub CLI and Node.js archive SHA-256 values, verifies the pinned Vercel npm lockfile SHA-256, and installs the Vercel CLI with that lockfile. The resulting package includes `tools/THIRD_PARTY_NOTICES.md` and the referenced license files.

| Bundled tool | Pinned version | License identified in local source | Included notice or license |
| --- | --- | --- | --- |
| GitHub CLI | 2.65.0 | MIT | `tools/licenses/github-cli.txt` |
| crowline-isolated GitHub CLI | 2.65.0-crowline.1 | MIT; modified from upstream | Same MIT notice; `tools/github-isolated-source.json` and `tools/github-isolated-config.go.txt` identify the source and modification |
| Node.js | 22.23.3 | MIT | `tools/licenses/node.txt` |
| Vercel CLI | 50.29.0 | Apache-2.0 | `tools/licenses/vercel-cli.txt` |

The Vercel CLI bundle also contains its installed npm dependencies. Their package files and license or notice files remain under `tools/vercel/node_modules/` in a prepared bundle. The Vercel dependency set is pinned by `scripts/vercel-package-lock.json`.

The isolated GitHub helper is built with Go 1.26.8 from the checksum-pinned official source. Go 1.26 retains the app's macOS 12 minimum; [Go 1.27 requires macOS 13](https://go.dev/doc/go1.26#darwin). The crowline change in `scripts/isolated-github.mjs` prefixes the OS keyring service with the application and account namespace. Its mock-keyring regression test is `scripts/github-isolation_test.go`. This is a modified helper maintained by crowline, not an official GitHub CLI release.

This inventory records the local bundle inputs and the files the build retains. Before distributing binaries, review and include the full license/notice set for linked Go and Rust libraries and frontend dependencies as well as the retained Vercel dependency notices. The current helper-level inventory is not a complete binary attribution inventory. Known dependency advisories and review limits are recorded in [the security review](docs/security-review.md).

## Artwork provenance

`public/crowline.png` is the crow symbol used by the application; icons in `src-tauri/icons/` are derived from it. Its recorded built-in image-generation prompt and asset locations are in [docs/brand.md](docs/brand.md). No separate stock-asset license is recorded in this repository for that generated symbol.
