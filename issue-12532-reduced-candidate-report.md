# Reduced #12532 owner-identity candidate

## Gate
| Metric | Limit | Actual |
| --- | --- | --- |
| Total files | ≤45 | **28** |
| Production | ≤28 | **15** |
| Tests | — | **12** |
| Docs | — | **1** retention table |

## SHAs
| Role | SHA |
| --- | --- |
| Base (#13611) | `d0271cb46f2871c201f39c51e35356efd4658eac` |
| Archived broad 66-file tip | `7c64936ce7` / docs `39d2585a90` on `archive/issue-12532-broad-66file-7c64936-20260810-122250` |
| Reduced candidate | `253f8c3f9e48dfec505d7ec96e104f099cf365a1` on `brennanb2025/issue-12532-owner-identity-narrow` (unpushed) |

## Retention table
`issue-12532-reduced-retention-table.md`

## Validation
- Focused + legacy identity/sticky suite: **1110 passed** (20 files)
- typecheck web/node: pass
- oxlint production files: 0 errors
- max-lines ratchet / reliability gates: pass
- #13611 virtual-rows / host-section-rows: **unchanged**

## Remaining QA
Independent review; multi-host UI smoke for same-id collapse/CRUD; full monorepo CI optional.
