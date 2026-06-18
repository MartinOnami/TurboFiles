# Recommended Plugins & Skills

TurboFiles is a real engineering project, so the highest-leverage plugins/skills are
the **engineering**, **design**, and **product-management** ones you already have
installed, plus the GitHub connector for CI/PR work. Use them like this.

## Engineering (core to this repo)
| Skill / command | Use it when |
| --- | --- |
| `engineering:architecture` | Recording new ADRs (we started one in `docs/adr/`). |
| `engineering:system-design` | Designing milestone features (sync engine, resume, pooling). |
| `engineering:code-review` or `/review` | Reviewing each PR before merge. |
| `/security-review` | Auditing diffs that touch auth, TLS, keychain, or file paths. |
| `engineering:testing-strategy` | Planning protocol/end-to-end test coverage. |
| `engineering:debug` | Triaging a failing transfer or handshake. |
| `engineering:documentation` | Keeping API/runbook docs current. |
| `engineering:deploy-checklist` | Before cutting a signed release. |
| `engineering:tech-debt` | Periodic health passes as the codebase grows. |
| `engineering:incident-response` | If a shipped build has a serious regression. |

**Connectors:** **GitHub** (PRs, Actions, releases), **Datadog** / **PagerDuty**
(if you add telemetry/alerting later).

## Design (the UI is a feature)
| Skill | Use it when |
| --- | --- |
| `design:design-critique` | Reviewing the dual-pane layout and theme polish. |
| `design:accessibility-review` | WCAG pass on contrast, keyboard nav, focus states. |
| `design:design-system` | Documenting the token/component system in `index.css`. |
| `design:ux-copy` | Wording errors, empty states, and tooltips. |

## Product & process
| Skill | Use it when |
| --- | --- |
| `product-management:write-spec` | Turning roadmap items into PRDs. |
| `product-management:roadmap-update` | Maintaining `docs/ROADMAP.md`. |
| `product-management:sprint-planning` | Scoping milestone work. |
| `product-management:competitive-brief` | Tracking FileZilla/Cyberduck/WinSCP. |
| `operations:runbook` / `operations:risk-assessment` | Release runbooks, risk register. |

## Authoring & automation
- `doc-coauthoring` — structured co-authoring for specs and decision docs.
- `skill-creator` — if you want a custom "new-protocol scaffold" skill.
- `schedule` — e.g. a weekly dependency-audit reminder.

## Suggested first moves
1. Connect the **GitHub** connector and push this repo.
2. Run `/security-review` on the protocol + keychain code paths.
3. Run `design:accessibility-review` on the UI before the first release.
