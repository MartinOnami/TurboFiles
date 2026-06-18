# Permissions & first-run prompts

TurboFiles is a desktop app, so it does **not** use a mobile-style "grant permissions"
wizard. The handful of capabilities it needs are requested by the operating system
itself, at the moment they're first used, and the app keeps working (with reduced
convenience) if you decline. This page lists every prompt you might see and why.

## What TurboFiles actually needs

| Capability | When it's used | How consent is asked |
| --- | --- | --- |
| **Keychain / secret store** | Saving a site password, key passphrase, or a BYOK assistant API key | The OS prompts on first access (macOS: "TurboFiles wants to use your confidential information stored in … in your keychain"). Secrets live **only** in the OS keychain - never in SQLite, logs, or the frontend. |
| **Outbound network** | Connecting over SFTP/FTP/FTPS, and the optional assistant's HTTPS calls to your chosen model provider | No prompt on Windows/Linux. macOS may show a **Local Network** prompt for LAN servers. |
| **Local files you pick** | Browsing the local pane, uploading, downloading, "Open with…" | Native file/folder picker - choosing a path *is* the consent. macOS may show a one-time **Downloads/Documents/Desktop** access prompt (TCC) the first time you touch those folders. |

That's the whole list. TurboFiles does **not** request camera, microphone, contacts,
location, or background-activity permissions.

## Designed to survive a "No"

- A site can be **saved without a stored password** - you'll simply be asked for it
  at connect time (and can choose whether to remember it). So declining keychain
  access never blocks you from connecting.
- The BYOK assistant is **entirely optional**; if you never add a key, nothing is
  stored and no provider is contacted.

## Per-platform notes

### macOS
- Builds use the **hardened runtime** with a minimal entitlements set
  (`src-tauri/entitlements.plist`): outbound/inbound network (FTP active mode opens a
  local data channel) and login-keychain access. The app is **not** App Store
  sandboxed, because a file-transfer client must read/write the arbitrary local
  paths you choose.
- Signed + **notarized** builds (see release secrets) open without Gatekeeper
  warnings. An unsigned local build is opened via right-click → **Open** the first time.

### Windows
- No runtime permission prompts. The installer is **per-user** (`installMode:
  currentUser`), so it does **not** require administrator rights.
- An unsigned installer triggers **SmartScreen** ("Windows protected your PC") →
  *More info* → *Run anyway*. Signing with an EV/OV certificate removes this.

### Linux
- No runtime permission prompts. The `.AppImage` needs `chmod +x`; the `.deb`/`.rpm`
  install through your package manager. Secrets use the Secret Service API
  (GNOME Keyring / KWallet) via libsecret.
