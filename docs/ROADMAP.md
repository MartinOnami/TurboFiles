# Roadmap

Milestones toward practical FileZilla parity with a modern UI. Each is bounded so
it can be implemented, tested, and shipped independently (and is agent-friendly -
see DEVELOPMENT.md "Working in a loop").

| # | Milestone | Status |
| - | --------- | ------ |
| 1 | App shell + dual-pane UI + theming | ✅ Done |
| 2 | Local file browser (Rust-backed) | ✅ Done |
| 3 | Site Manager (SQLite) + keychain secrets | ✅ Done |
| 4 | SFTP connect / list / upload / download | ✅ Done |
| 5 | Transfer queue with progress events | ✅ Done |
| 6 | FTP / FTPS support | 🟡 Initial |
| 7 | Pause / resume / cancel mid-stream | 🟡 Partial (pause done; mid-stream cancel pending) |
| 8 | Multi-tab sessions | ⬜ Planned |
| 9 | Drag & drop transfers | ⬜ Planned |
| 10 | Resume interrupted transfers (offset restart) | ⬜ Planned |
| 11 | Recursive folder upload/download + sync | ⬜ Planned |
| 12 | Import FileZilla `sitemanager.xml` | ⬜ Planned |
| 13 | Speed limiting / connection pooling | ⬜ Planned |
| 14 | Packaging, signing & auto-update for all 3 OSes | 🟡 CI ready, signing secrets TODO |

Legend: ✅ done · 🟡 in progress/partial · ⬜ planned
