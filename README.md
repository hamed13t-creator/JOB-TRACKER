# Expat Job Tracker

Installable web app (PWA) to track job applications abroad and rank them against your CV.
No account, no server: jobs and CV stay in the phone's browser storage. Works offline.

## Features (phase 1)
- Import a CV (PDF, DOCX, TXT), read on the device; every job gets a match score.
- Add jobs by pasting the ad, or by sharing it from another app (Android); fields fill in automatically.
- Filter by location, category, status and minimum match; follow-up dates with calendar (.ics) export.
- Search links for LinkedIn, Indeed, Google Jobs, Bayt, GulfTalent, Naukrigulf and any site you add.
- Backup/restore (JSON), CSV export/import (reads the v1 tracker's CSV). English and French.

## Features (phase 2)
- Profile for CVs, filled from the CV file in one tap (then checked by the user), or with AI.
- Tailored CV per job: Gulf, Europe or Canada format, EN/FR headings, matching points first, target role in the summary. Word (.docx) or PDF (print).
- Cover letter draft built from the user's own experience, editable, Word/PDF/copy.
- Optional AI (user's own Anthropic API key, stored on the device only, never in backups): fill profile, rewrite summary, improve letter. Prompts forbid inventing facts.
- Each job keeps a record of which CV/letter was created for it.

## Run locally
```
python3 -m http.server 8000
```
Open http://localhost:8000. No build step.

## Deploy on Cloudflare Pages
1. Push this folder to a GitHub repository.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo.
3. Framework preset: None. Build command: empty. Build output directory: `/`.
4. Deploy. Every push to the main branch redeploys.

## Releasing an update
Change `VERSION` in `sw.js` on every release, otherwise installed phones keep the old cached files.
Users then see "A new version is ready" with a Reload button.

## Files
- `index.html`, `css/app.css`: app shell and styles
- `js/app.js`: views and logic · `js/match.js`: CV/job scoring · `js/parsead.js`: ad parser
- `js/cvread.js`: PDF/DOCX reading · `js/store.js`: IndexedDB · `js/io.js`: backup, CSV, .ics, search links
- `sw.js`: offline cache · `manifest.webmanifest`: install + share target · `_headers`: Cloudflare security headers
- `vendor/pdfjs/`: Mozilla pdf.js (Apache-2.0)
