# Feature Parity vs FileZilla

Tracks TurboFiles against FileZilla Client features. Update this with every PR that
changes capabilities.

| Feature | FileZilla | TurboFiles | Notes |
| --- | --- | --- | --- |
| SFTP | ✅ | ✅ | Password + key auth |
| FTP | ✅ | 🟡 | Core ops; Unix `LIST` parsing only |
| FTPS (explicit) | ✅ | 🟡 | TLS via native-tls |
| FTPS (implicit) | ✅ | ⬜ | Not yet |
| Local file browser | ✅ | ✅ | |
| Remote file browser | ✅ | ✅ | |
| Transfer queue | ✅ | ✅ | Progress, speed, ETA |
| Pause/resume | ✅ | 🟡 | Pause works; resume = unpause (not offset-restart) |
| Cancel | ✅ | 🟡 | Pre-start cancel; mid-stream pending |
| Resume interrupted transfer | ✅ | ⬜ | Offset restart planned (roadmap #10) |
| Recursive folder transfer | ✅ | ⬜ | Planned (#11) |
| Directory comparison / sync | ✅ | ⬜ | Planned |
| Drag & drop | ✅ | ⬜ | Planned (#9) |
| Multi-tab / multi-session | ✅ | 🟡 | UI tabs present; multi-session wiring pending |
| Site Manager | ✅ | ✅ | SQLite + keychain |
| Import FileZilla sites | n/a | ⬜ | Planned (#12) |
| Speed limits | ✅ | ⬜ | Planned (#13) |
| Bookmarks | ✅ | ⬜ | Planned |
| Logs panel | ✅ | ✅ | |
| Theming (dark/light) | ⬜ | ✅ | TurboFiles advantage |
| Cross-platform | ✅ | ✅ | macOS/Windows/Linux |

Legend: ✅ complete · 🟡 partial · ⬜ not started
