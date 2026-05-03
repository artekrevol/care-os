# Test fixtures

Sample documents for AI Document Intake. In dev (no `ANTHROPIC_API_KEY` /
`AWS_*`) the workers run in stub mode and return deterministic mock fields,
so the binary contents of these fixtures do not need to match real OCR.

## referrals/
- `va-ccn-referral.pdf` — VA CCN referral; stub returns `Robert Va-Ccn-Referral`,
  payer `VA_CCN`, ~480 hours, ~86% confidence.
- `medicaid-referral.pdf` — Medicaid HCBS referral.
- `private-pay-referral.pdf` — Private pay self-referral.

## classifier/
- `tb_test_2026.pdf` → `TB_TEST` (filename heuristic, +1y expiry)
- `cpr_card.pdf` → `CPR` (+2y expiry)
- `live_scan_background_check.pdf` → `BACKGROUND_CHECK` (+1y expiry)
- `i9_form.pdf` → `I9` (no expiry)
- `random_doc.pdf` → `OTHER` (low confidence, flagged for review)
