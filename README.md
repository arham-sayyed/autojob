# Job Outreach Bot

A single-user, single-machine automation pipeline for job-searching: it finds nearby
software companies via Google Maps, scrapes each company's website for a contact email
and open roles, drafts a personalized outreach email with Groq, sends it (with your
resume attached), and tracks everything in a local Excel file so no company is ever
contacted twice. It can optionally follow up after a set number of days and send a
WhatsApp message via `whatsapp-web.js`.

## How it works

```
discover  ->  scrape  ->  groq-draft  ->  send  ->  whatsapp  ->  followup
```

1. **discover** — searches Google Maps (Puppeteer) for companies matching
   `SEARCH_TERMS` in `SEARCH_CITIES` and upserts new rows into `companies.xlsx`
   (`Status=New`).
2. **scrape** — crawls each `New` company's website (Cheerio, with a Puppeteer
   fallback), extracting a contact email, phone numbers, careers page/ATS, open job
   titles, and tech stack; scores fit and sets `Status=EmailFound` / `NoEmailFound`.
3. **groq-draft** — for `EmailFound` rows, generates a personalized email, follow-up
   email, and WhatsApp message via the Groq API, using your resume highlights.
4. **send** — sends drafted emails via SMTP (Nodemailer), respecting
   `DAILY_SEND_CAP` and `AUTOPILOT`; sets `Status=Emailed`.
5. **whatsapp** — sends drafted WhatsApp messages via `whatsapp-web.js`, respecting
   `DAILY_WHATSAPP_CAP` and `AUTOPILOT`.
6. **followup** — sends the drafted follow-up email for `Emailed` rows once
   `FOLLOW_UP_AFTER_DAYS` has passed; sets `Status=FollowedUp`.
7. **backup** — saves a timestamped copy of `companies.xlsx` to `data/backups/`.
8. **report** — generates a PDF summary (headline stats, pipeline funnel, WhatsApp
   status breakdown, top fit-score companies) into `reports/`.

`run-all` chains all of the above in order.

Everything is tracked in `companies.xlsx` (via `exceljs`), which acts as the single
source of truth — commands are idempotent and safe to re-run.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key, used to draft emails/summaries |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP credentials for sending email (e.g. Gmail + app password) |
| `RESUME_PATH` | Path to your resume file to attach (default `./data/resume.pdf`) |
| `DAILY_SEND_CAP` | Max emails sent per run |
| `DAILY_WHATSAPP_CAP` | Max WhatsApp messages sent per run |
| `FOLLOW_UP_AFTER_DAYS` | Days to wait before sending a follow-up |
| `SEARCH_CITIES` | Comma-separated cities to search on Google Maps |
| `SEARCH_TERMS` | Comma-separated search terms (e.g. `software company,startup`) |
| `TEST_WHATSAPP_NUMBER` | Optional: your own number to receive test sends while `AUTOPILOT=false` |
| `AUTOPILOT` | Master kill switch. `false` (default) keeps sends in safe/manual-review mode; set `true` only after reviewing real output end-to-end |

Also fill in `data/resume-highlights.txt` with a short summary of your background —
it's used to personalize drafted emails. `data/resume.pdf` (or whatever `RESUME_PATH`
points to) is the file attached to outreach emails.

On first `whatsapp` run, scan the QR code printed to the terminal to authenticate;
the session is persisted to disk so you won't need to scan again.

## Usage

```bash
npm run discover    # find companies via Google Maps
npm run scrape       # extract email/phone/careers/tech-stack for new companies
npm run backup       # snapshot companies.xlsx to data/backups/
npm run groq-draft   # draft personalized emails
npm run send         # send drafted emails
npm run followup     # send due follow-up emails
npm run whatsapp     # send drafted WhatsApp messages
npm run run-all      # run the full pipeline end to end
npm run report       # generate a PDF summary report into reports/
```

All commands accept:
- `--from=N --to=M` — process only rows `N` to `M` (0-based, `--to` exclusive)
- `--dry-run` — (`discover`/`scrape` only) log extracted data without writing to the sheet

## Testing

```bash
npm test
```

Runs the Vitest suite in `tests/` (extractors, email sending, WhatsApp sending, Excel
storage, backups, Groq drafting, graceful exit) against HTML fixtures in
`tests/fixtures/`.

## Project structure

```
src/
  index.ts              CLI entrypoint and pipeline stages
  config.ts             env var loading/validation
  ai/groq.ts             summarize / score fit / draft email, follow-up, WhatsApp
  scrapers/
    googleMaps.ts        Google Maps company discovery (Puppeteer)
    website.ts            website crawling (Cheerio + Puppeteer fallback)
  extractors/
    email.ts              email extraction/scoring from HTML
    phone.ts               phone number extraction
    careers.ts             careers page + ATS detection, job title extraction
    techStack.ts            tech stack detection
  email/sender.ts        SMTP sending via Nodemailer
  whatsapp/sender.ts     WhatsApp sending via whatsapp-web.js
  storage/
    excel.ts               companies.xlsx read/write (source of truth)
    backup.ts               timestamped backups
  utils/
    logger.ts
    rateLimiter.ts
    gracefulExit.ts        pipeline stage runner + shutdown handling
```

## Notes

- This is a rate-limited, personal job-search tool, not a bulk sender — keep
  `DAILY_SEND_CAP` / `DAILY_WHATSAPP_CAP` low and respect opt-out requests.
- Automating a personal WhatsApp account via `whatsapp-web.js` is against WhatsApp's
  Terms of Service for bulk/automated messaging and risks the number being flagged;
  use conservative caps.
- No ATS auto-apply — the bot detects Greenhouse/Lever/Workable careers pages and
  extracts job titles but does not submit applications.

## License

[MIT](./LICENSE)
