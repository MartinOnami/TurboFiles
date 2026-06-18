# Docker assets

- `Dockerfile` — reproducible Linux build environment for TurboFiles (used by CI and
  for local `.deb`/AppImage bundling). Run from the repo root:
  ```bash
  docker build -f docker/Dockerfile -t turbofiles-build .
  ```
- `docker-compose.test.yml` — SFTP, FTP and FTPS servers for integration testing:
  ```bash
  docker compose -f docker/docker-compose.test.yml up -d
  ```
  Credentials: `testuser` / `testpass`. Ports: SFTP `2222`, FTP `21`, FTPS `2121`.
