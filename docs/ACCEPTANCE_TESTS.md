# Acceptance Tests

Manual + automated criteria a release must satisfy. Automated coverage lives in
`tests/` (frontend) and `src-tauri/tests` + `#[cfg(test)]` modules (backend);
protocol end-to-end tests run against `docker/docker-compose.test.yml`.

## Connection
- [ ] **AC-1** SFTP connect with valid password → session established, remote
      listing shown.
- [ ] **AC-2** SFTP connect with private key + passphrase → session established.
- [ ] **AC-3** Invalid credentials → `AUTH` error surfaced in the UI; no crash.
- [ ] **AC-4** FTP connect to test server → listing shown.
- [ ] **AC-5** FTPS connect upgrades to TLS before login.

## Browsing
- [ ] **AC-6** Double-click a remote folder navigates into it.
- [ ] **AC-7** `..` / up button navigates to the parent.
- [ ] **AC-8** Directories sort before files; names case-insensitive.

## Transfers
- [ ] **AC-9** Upload a file → appears on the server with identical size/bytes.
- [ ] **AC-10** Download a file → local copy matches remote (checksum).
- [ ] **AC-11** Progress events update percentage, speed, and ETA live.
- [ ] **AC-12** Pause halts byte flow; resume continues to completion.
- [ ] **AC-13** Failed transfer reports `failed` status with an error message.

## Site Manager & secrets
- [ ] **AC-14** Save a site → reappears after restart (SQLite persisted).
- [ ] **AC-15** Saved secret is retrievable from the OS keychain, absent from
      SQLite and logs.
- [ ] **AC-16** Delete a site → removed from list and keychain.

## UI/UX
- [ ] **AC-17** Theme toggle switches light/dark and persists across restarts.
- [ ] **AC-18** App is usable at the minimum window size (940×600).

## Quality gates (CI)
- [ ] **AC-19** `npm run lint`, `typecheck`, `test` pass.
- [ ] **AC-20** `cargo fmt --check`, `clippy -D warnings`, `cargo test` pass.
- [ ] **AC-21** `cargo audit` / `npm audit` report no unresolved high/critical.
