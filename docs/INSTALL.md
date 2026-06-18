# Installing & Building TurboFiles

TurboFiles ships as a native desktop app for **macOS, Linux, and Windows** (built with
Tauri). On first launch it shows a short welcome screen; everything else is the app.

## Get a prebuilt installer (easiest)

Grab the file for your OS from the [Releases page](https://github.com/MartinOnami/TurboFiles/releases):

| OS | Download | Install |
| --- | --- | --- |
| macOS | `TurboFiles_x.y.z_universal.dmg` | Open the DMG, drag TurboFiles to Applications |
| Windows | `TurboFiles_x.y.z_x64-setup.exe` (or `.msi`) | Run it and follow the prompts |
| Linux | `TurboFiles_x.y.z_amd64.AppImage` | `chmod +x` it and run; or install the `.deb`/`.rpm` |

## Build it yourself

Prerequisites: **Node 20+**, **Rust (stable)**, and the
[Tauri OS dependencies](https://tauri.app/start/prerequisites/) for your platform
(on Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev`, etc.).

```bash
npm ci
npm run tauri:build
```

That's it. The installer for the OS you ran it on lands in:

```
src-tauri/target/release/bundle/
  macos/   → TurboFiles.app, dmg/TurboFiles_*.dmg
  deb/ rpm/ appimage/   (Linux)
  msi/ nsis/            (Windows)
```

Run `npm run tauri:dev` for a hot-reloading dev build.

## Cutting a release (all three OSes at once)

Pushing a version tag builds and publishes signed bundles for every platform via
GitHub Actions (`.github/workflows/release.yml`):

```bash
npm version patch          # bumps package.json + tauri.conf version
git push && git push --tags
```

This produces a **draft GitHub Release** with the macOS/Windows/Linux installers
attached. Code-signing/notarization is wired up via repo secrets (`APPLE_*`,
`TAURI_SIGNING_*`); without them the bundles are unsigned but still install.

## Host the installers on your own website

You don't need GitHub Releases - you can serve the installers from your own server
and link to them from the [landing page](../website/). After a build, gather every
platform's installer (with SHA-256 checksums and a `latest.json` manifest) into one
folder:

```bash
# build on each OS (or download the CI artifacts), then on each machine:
npm run tauri:build
scripts/collect-bundles.sh            # → ./release-uploads/<version>/
```

`collect-bundles.sh` copies the `.dmg`, `.exe`/`.msi`, `.AppImage`/`.deb`/`.rpm`
into `release-uploads/<version>/`, writes `SHA256SUMS.txt`, and emits a
`latest.json` describing the current version + filenames. Upload that folder to your
web root, e.g.:

```bash
rsync -avz release-uploads/0.1.0/ user@yourserver:/var/www/turbofiles/download/0.1.0/
```

Then point the landing page's download buttons at
`https://yourdomain/download/<version>/<file>` (the page reads `latest.json`, so you
only edit one file per release). Serve over HTTPS so SmartScreen/Gatekeeper checks
and checksum verification work cleanly.

> **Signing matters more when self-hosting.** GitHub adds no trust of its own, so an
> unsigned `.exe` shows SmartScreen and an unsigned `.app` is Gatekeeper-blocked.
> Ship **notarized** macOS builds and a **signed** Windows installer for a clean
> download experience. See [PERMISSIONS.md](PERMISSIONS.md).
