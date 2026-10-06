# Third-party notices

The crowline source itself is licensed under the [MIT License](LICENSE). Current desktop builds do not include GitHub CLI, a modified GitHub helper, Node.js, Vercel CLI, or any other provider executable. Provider access is described in [authentication and provider access](docs/authentication.md).

The former helper-preparation scripts, tool lockfiles, and Tauri tool resource directory were removed with the bundled-tool migration. Historical documents may mention them as dated evidence; they are not an attribution list for a current crowline installer.

Before distributing binaries, review and include the complete attribution required for the actual Rust, frontend, and platform dependencies in that build. Known dependency advisories and dated review limits are recorded in [the security review](docs/security-review.md).

## Artwork provenance

`public/crowline.png` is the crow symbol used by the application; icons in `src-tauri/icons/` are derived from it. Its recorded built-in image-generation prompt and asset locations are in [docs/brand.md](docs/brand.md). No separate stock-asset license is recorded in this repository for that generated symbol.

## Platform logos

`public/providers/` contains vendored SVG marks downloaded on 2026-09-30:

- Simple Icons: https://github.com/simple-icons/simple-icons (`develop/icons/`), CC0-1.0. Includes GitHub, Vercel, Railway, Netlify, Render, Cloudflare, Fly.io, GitLab, Bitbucket, DigitalOcean, Google Cloud, Expo, Firebase, Supabase, and fastlane. License copy: `public/providers/simple-icons-LICENSE.md`.
- Bitbucket mark source: `https://cdn.simpleicons.org/bitbucket`, downloaded 2026-09-30 under the Simple Icons license above.
- Devicon: https://github.com/devicons/devicon (`master/icons/`), MIT. Includes Amazon Web Services (`amazonwebservices-original-wordmark.svg`), Azure (`azure-original.svg`), and Heroku (`heroku-original.svg`). License copy: `public/providers/devicon-LICENSE`.

Logos identify the corresponding services; trademarks belong to their owners. Assets are bundled locally and rendered in monochrome for the dark interface. The app makes no runtime requests to an icon CDN.
