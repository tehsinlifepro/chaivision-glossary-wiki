# ChaiVision Company Glossary Wiki

A tiny, dependency-free static site that turns the company glossary Google Sheet
into a searchable, department-filtered wiki. Rebuilt automatically every day.

- **Live site:** GitHub Pages (see repo *Settings → Pages*)
- **Source of truth:** the `Chai_Vision_Company_Glossary` Google Sheet. All edits happen
  there. This wiki only ever **reads** it — the daily build shows terms marked **Approved**.
- **Access:** the site is public, but the glossary payload is **AES-encrypted** with a
  passcode. Visitors must type the passcode to unlock/decrypt it.

## How it works

```
Google Sheet ──gws (authenticated)──▶ build.mjs ──filter Status=Approved──▶ encrypt
      └────────────────────────────────────────────────────────────────────────┘
                                        │
                          docs/data.enc.json + docs/meta.json
                                        │  git push
                                        ▼
                         GitHub Pages  ──passcode decrypts──▶  browser
```

- `build.mjs` — reads the 6 department tabs via the `gws` CLI, keeps only `Status = Approved`
  rows, and writes an encrypted payload (`docs/data.enc.json`) plus public metadata
  (`docs/meta.json`, term counts only — no term text).
- `docs/` — the static site (vanilla HTML/CSS/JS, no build step, no framework).
  Palette and font match [chaivision.com](https://chaivision.com) (navy `#0C2748`,
  coral `#E1624B`, Inter).

## Local commands

```bash
# one-time
cp .env.example .env        # then set WIKI_PASSCODE

npm run build               # read sheet + rebuild docs/ locally
npm run update              # build + commit + push (what the daily job runs)
```

## Changing the passcode

Edit `WIKI_PASSCODE` in `.env`, then `npm run update`. The old passcode stops working
on the next build (each build re-encrypts with a fresh salt).

## Showing pending terms too

By default only **Approved** terms appear. To preview everything, set `APPROVED_ONLY = false`
at the top of `build.mjs` and rebuild.

## Daily refresh

A local `launchd` agent (`~/Library/LaunchAgents/com.chaivision.glossary-wiki.plist`)
runs `update.sh` every morning. It must run locally because Google Sheets access uses
the `gws` credentials in the machine's keychain. Logs: `update.log` in this folder.
