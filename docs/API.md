# API Reference - Tauri Commands & Events

The frontend talks to the backend exclusively through the commands below, wrapped
in `src/lib/api.ts`. All payloads use `camelCase`. On failure a command rejects
with an `ApiError`:

```ts
interface ApiError { code: string; message: string }
```

`code` is one of: `CONNECTION`, `AUTH`, `SESSION_NOT_FOUND`, `TRANSFER_NOT_FOUND`,
`REMOTE`, `IO`, `DB`, `KEYCHAIN`, `INVALID`.

## Connection

### `connect(req: ConnectionRequest) → Session`
Opens a connection and registers a session.
```ts
interface ConnectionRequest {
  protocol: "sftp" | "ftp" | "ftps";
  host: string; port: number; username: string;
  password?: string;       // password auth
  privateKey?: string;     // SFTP key auth (PEM contents)
  passphrase?: string;     // key passphrase
}
interface Session { id: string; protocol: Protocol; host: string; username: string; cwd: string }
```
The request also accepts optional `ftpEncryption`, `ftpMode`, `acceptInvalidCert`,
`timeoutSecs`, `retries`, `retryDelaySecs`, a `proxy` object
(`{ type: "socks4"|"socks5"|"http", host, port, username?, password? }`),
`minTlsVersion` (`"1.0"`..`"1.3"`, FTPS floor; default `"1.2"`),
`sftpCompression` (request zlib compression on SFTP), `useAgent`
(try the SSH agent / `SSH_AUTH_SOCK` before password/key for SFTP),
`ftpKeepAlive` (send periodic `NOOP` to keep an idle FTP control connection
alive), `preallocate` (reserve the file size before an SFTP download), and
`maxConcurrent` (max simultaneous transfer connections for the session; default 1).

**Security:** SFTP verifies the server host key before sending credentials
(trust-on-first-use). A first connection remembers the key; a later connection
whose key differs fails with `HOST_KEY_MISMATCH`. FTPS verifies the TLS cert and
fails with `CERT_UNTRUSTED` unless the user has trusted it. Errors: `CONNECTION`,
`AUTH`, `CERT_UNTRUSTED`, `HOST_KEY_MISMATCH`, `REMOTE`.

### `forgetHostKey(host: string, port: number) → void`
Forget a remembered SSH host key, so the next connect re-trusts the current key
(used to accept a legitimately-rotated server key after a `HOST_KEY_MISMATCH`).

### `disconnect(sessionId: string) → void`
Closes and drops a session. No error if already gone.

### `listRemote(sessionId: string, path: string) → DirEntry[]`
Lists a remote directory. Errors: `SESSION_NOT_FOUND`, `REMOTE`.

## Local filesystem

### `listLocal(path: string) → DirEntry[]`
Lists a local directory. Errors: `IO`.

### `homeDir() → string`
Returns the user's home directory. Errors: `INVALID`.

### `openPath(path) → void` / `revealInFinder(path) → void`
Open a local path with the OS default app, or reveal it in the file manager.

### `openWith(path, app) → void`
Open a local path with a specific application (the "Open With…" flow). On macOS
`app` is an application name or `.app` path; elsewhere it is an executable path.

### `downloadToTemp(sessionId, remotePath) → string`
Download a remote file to a temp dir and return the local path, so the frontend
can `openPath` it ("Open with…" for remote files). Errors: `SESSION_NOT_FOUND`, `REMOTE`.

### `readRemoteText(sessionId, path, maxBytes?) → string`
Read a small remote text file (config/version/log) as UTF-8, capped at `maxBytes`
(≤ 1 MiB). Used by the assistant to inspect files. Errors: `SESSION_NOT_FOUND`, `REMOTE`.

### `startFileEdit(sessionId, remotePath, editor?, fresh?) → string`
Download a remote file to a temp dir, open it (with `editor` or the OS default
app), and watch it: each time the local copy is saved, the backend emits
`editor://changed` with `{ sessionId, remotePath, localPath }`. The frontend then
confirms with the user (unless disabled) and queues the upload via `enqueueUpload`.
If the file is already being edited, `fresh = true` discards the local copy and
re-downloads; any other value reopens the existing local copy. The watcher stops
when the session closes. Returns the temp path. Errors: `SESSION_NOT_FOUND`, `REMOTE`.

### `isFileBeingEdited(remotePath) → boolean`
Whether a remote file already has a local copy open for editing (an active
watcher). Used to offer "reopen local" vs "discard and re-download".

```ts
type EntryKind = "file" | "directory" | "symlink";
interface DirEntry {
  name: string; path: string; kind: EntryKind; size: number;
  modified?: string; permissions?: string; owner?: string;
}
```

## Transfers

### `enqueueUpload(sessionId, localPath, remotePath) → Transfer[]`
### `enqueueDownload(sessionId, remotePath, localPath, isDirectory?, resume?, filter?) → Transfer[]`
Queue a transfer. If the source is a directory the tree is expanded into one
`Transfer` per file (creating destination directories as needed), so the return
value is the **array** of queued transfers. For `enqueueDownload`, pass
`isDirectory: true` when the remote path is a folder. The optional `filter`
(`{ chars, replacement }`) replaces illegal characters in server-supplied
filenames; path separators and control characters are always replaced.

Transfers run through a **per-session FIFO scheduler** backed by a connection
pool: a session runs up to `maxConcurrent` transfers at once (default 1 ⇒
sequential), each over its own pooled connection, while a separate interactive
connection handles browsing. Different sessions always run in parallel. A
per-site `connectionLimit` caps the pool size. Errors: `SESSION_NOT_FOUND`.

### `setSpeedLimits(downloadKib, uploadKib, burstSecs?, momentarySpeed?) → void`
Set global transfer speed caps in KiB/s (0 = unlimited). `burstSecs` (0-30,
default 0) grants that many seconds' worth of allowance above the cap as a
short burst. `momentarySpeed` reports instantaneous instead of average speed.
Applies to transfers started after the change.

### `setPreventSleep(active) → void`
Hold (or release) an OS "stay awake" assertion while transfers run. macOS uses
`caffeinate`, Linux `systemd-inhibit`; other platforms are a no-op. Never errors.

### `pauseTransfer(id) / resumeTransfer(id) / cancelTransfer(id) → void`
Control a running or queued transfer. Cancelling a still-queued transfer
finalizes it as `cancelled` without ever starting it. Errors: `TRANSFER_NOT_FOUND`.

### `listTransfers() → Transfer[]`
Snapshot of all transfers.

Cancelling a *running* transfer aborts it at the next data chunk (the progress
callback signals the protocol loop to stop) and finalizes it as `cancelled`,
leaving any partial file in place.

```ts
type TransferStatus = "queued"|"transferring"|"paused"|"completed"|"failed"|"cancelled";
interface Transfer {
  id: string; direction: "upload"|"download"; name: string;
  localPath: string; remotePath: string; status: TransferStatus;
  bytesTransferred: number; totalBytes: number; speed: number;
  etaSeconds: number | null; error?: string; scope?: string;
}
```

## History (durable)

Logs and finished transfers are persisted to a SQLite history DB
(`turbofiles-history.sqlite`, sibling of the site store) so they survive restarts.
The frontend hydrates a recent window (latest 2000) at startup; the database
retains everything.

### `appendLog(entry) → void`  - also mirrors to the log file when enabled
### `listLogs() → LogEntry[]`  - latest 2000, oldest-first
### `clearLogs() → void`
### `setLogFile(path) → void`  - empty path disables file logging
### `debugInfo() → Record<string,string>`  - version / OS / paths / session count
### `recordTransfer(transfer, finishedAt) → void`  - upsert by id
### `listTransferHistory() → Transfer[]`  - latest 2000, oldest-first
### `clearTransferHistory() → void`  - purges completed/cancelled (failed kept)

```ts
interface LogEntry { timestamp: string; level: "info"|"warn"|"error"|"debug"; message: string; scope?: string; }
```

## Site Manager

### `listSites() → Site[]`
### `saveSite(site, secret?) → Site`  - `secret` (if given) is stored in the keychain.
### `deleteSite(id) → void`  - also removes the keychain secret.

```ts
interface Site {
  id: string; name: string; protocol: Protocol; host: string; port: number;
  username: string; defaultRemotePath?: string; hasStoredSecret: boolean;
  createdAt: string; updatedAt: string;
}
```

## Assistant (BYOK)

The optional natural-language assistant uses a Bring-Your-Own-Key model. The API
key is stored in the OS keychain and never returned to the web layer; `llmProxy`
injects it server-side, so the CSP stays locked to `'self'`.

### `llmSetKey(provider, key) → void`  - store (empty `key` clears) the provider's API key
### `llmHasKey(provider) → boolean`  - whether a key is stored (the key itself is never returned)
### `llmClearKey(provider) → void`  - remove the stored key
### `llmProxy(provider, url, body) → object`
Forward the provider-native chat-completion request `body` to `url`, injecting the
stored key as the correct auth header (`anthropic` → `x-api-key` +
`anthropic-version`; anything else → `Authorization: Bearer`). The key is optional
for OpenAI-compatible servers (local Ollama / LM Studio need none). Returns the raw
JSON response. Errors: `INVALID` (Anthropic with no key), `CONNECTION`, `REMOTE`.

### `llmListModels(provider, baseUrl) → string[]`
List model ids available from the provider - Anthropic's `/v1/models`, or any
OpenAI-compatible server's `/models` (blank `baseUrl` → OpenAI; works with local
Ollama / LM Studio). Used to populate the model picker.

## Updates

### `checkLatestRelease(repo) → ReleaseInfo | null`
Fetch the latest **published** GitHub release for `repo` ("owner/name"), via Rust
`reqwest` so the renderer's CSP stays locked to `'self'`. Returns `{ version, tag,
url, notes }`, or `null` when no release is published yet. The UI compares `version`
to the running `APP_VERSION` to decide whether to surface "Update available".

## Events

### `transfer://progress`
Emitted continuously by the transfer worker (throttled to ~150ms) and on
completion/failure.
```ts
interface TransferProgressEvent {
  id: string; bytesTransferred: number; totalBytes: number;
  speed: number; etaSeconds: number | null;
  status: TransferStatus; error?: string;
}
```
Subscribe via `onTransferProgress(handler)` which returns an unlisten function.
