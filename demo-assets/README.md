# Demo Assets

Fallback PNG screenshots of the seven CareOS "magic moment" views, captured
headlessly via Playwright against the live dev stack. Used when a presenter
cannot run the full app live (offline venue, broken wifi, etc.) and needs to
fall back to images.

## Capture

```sh
pnpm demo:reset           # deterministic Chajinel demo seed
pnpm demo:screenshots     # writes PNGs into demo-assets/
```

The harness lives at `scripts/src/demo-screenshots.ts`. It expects the four
artifacts (api-server, careos, caregiver-pwa, family-portal) to be running
and reachable through the shared proxy at `http://localhost:80`. Override
with `DEMO_BASE_URL` if needed.

## Files

| File                          | Anchor data                         |
| ----------------------------- | ----------------------------------- |
| `01-careos-dashboard.png`     | dashboard summary, OPEN alerts      |
| `02-careos-schedule.png`      | schedule grid with OT projection    |
| `03-careos-intake-review.png` | parsed VA Community Care referral   |
| `04-caregiver-visit.png`      | active visit for cg_001 / sch_001   |
| `05-family-today.png`         | clt_001 ON\_SITE today (fam\_001)   |
| `06-careos-payroll.png`       | pay period `pp_open` detail         |
| `07-careos-compliance.png`    | 8 OPEN compliance alerts            |
| `manifest.json`               | timestamp + per-shot status         |

The harness re-uses any existing referral drafts and any active visit it can
find. If no VA referral draft exists yet, it uploads the fixture at
`artifacts/api-server/test-fixtures/referrals/va-ccn-referral.pdf` and waits
for the parser to populate `parsedFields` before navigating to the review
page.

PNGs are intentionally not committed. Re-capture them before each live demo
so they reflect the current seed.
