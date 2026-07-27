# Job Outreach Bot

A personal automation tool for job-searching. Point it at a few cities and it will:

1. Find nearby software companies on Google Maps.
2. Visit each company's website and pull out a contact email, phone number, careers
   page, and open roles.
3. Use AI (Groq) to write a short, personalized outreach email (and WhatsApp message)
   for each company, based on your resume.
4. Send the email (with your resume attached), and optionally a WhatsApp message.
5. Keep track of every company in a spreadsheet, so you never accidentally email the
   same one twice.
6. Follow up automatically a set number of days later if you haven't heard back.
7. Generate a PDF report showing your progress.

It runs entirely on your own computer — nothing is uploaded anywhere except the emails
and messages you choose to send, and the API calls needed to find companies and draft
text.

**This tool is safe by default.** Until you explicitly turn on `AUTOPILOT` (see below),
it will not send anything to a real company — it drafts everything and sends it to
*you* instead, so you can read exactly what it would have sent before it ever reaches
anyone else.

> No coding experience is required to use this — just the ability to follow steps in a
> terminal (a text-based command window). Every step below is spelled out in full.

---

## Before you start

You'll need:

- **A computer** running Windows, macOS, or Linux.
- **Node.js** version 18 or newer — this is the program that runs the bot.
  - Download it from [nodejs.org](https://nodejs.org) (pick the "LTS" version) and
    run the installer. This also installs `npm`, which you'll use below.
- **A Gmail account** (or any email account that supports SMTP) to send emails from.
- **A free Groq API key** — Groq is the AI service that writes the emails. Sign up at
  [console.groq.com](https://console.groq.com), create an API key, and keep it handy.
- **Your resume** as a PDF file.
- About 15 minutes for one-time setup.

---

## Setup (do this once)

### 1. Get the code

Download this repository (via `git clone` if you're comfortable with Git, or the
"Download ZIP" button on GitHub and unzip it), then open a terminal in that folder.

- **Windows:** open the folder in File Explorer, then right-click inside it and choose
  "Open in Terminal" (or "Git Bash Here").
- **macOS:** open Terminal, then type `cd ` (with a trailing space), drag the folder
  into the Terminal window, and press Enter.

### 2. Install dependencies

In the terminal, run:

```bash
npm install
```

This downloads everything the bot needs, including a private copy of Chrome (used for
web scraping) — the first run can take a few minutes and needs a stable internet
connection.

### 3. Create your configuration file

Copy the example configuration file to a real one:

```bash
cp .env.example .env
```

(On Windows, if `cp` doesn't work, just duplicate `.env.example` in File Explorer and
rename the copy to `.env`.)

Now open `.env` in any text editor (Notepad, VS Code, etc.) and fill in the blanks.
Here's what each line means:

| Setting | What to put there |
|---|---|
| `GROQ_API_KEY` | The API key you created at console.groq.com |
| `SMTP_HOST` | Leave as `smtp.gmail.com` if using Gmail |
| `SMTP_PORT` | Leave as `465` if using Gmail |
| `SMTP_USER` | Your full Gmail address, e.g. `you@gmail.com` |
| `SMTP_PASS` | A Gmail **App Password** (not your normal password — see below) |
| `RESUME_PATH` | Leave as `./data/resume.pdf` if you follow step 4 below |
| `DAILY_SEND_CAP` | Max emails to send per run, e.g. `25` (keep this modest) |
| `DAILY_WHATSAPP_CAP` | Max WhatsApp messages to send per run, e.g. `25` |
| `FOLLOW_UP_AFTER_DAYS` | How many days to wait before following up, e.g. `7` |
| `SEARCH_CITIES` | Comma-separated cities to search, e.g. `Mumbai,Pune,Bangalore` |
| `SEARCH_TERMS` | Comma-separated search terms, e.g. `software company,startup` |
| `TEST_WHATSAPP_NUMBER` | Optional — your own WhatsApp number (with country code, e.g. `9198XXXXXXXX`) to receive test messages |
| `AUTOPILOT` | Leave as `false` for now — see the safety section below |

**How to create a Gmail App Password** (needed because Gmail blocks plain-password
logins from apps like this one):

1. Turn on 2-Step Verification on your Google account, if it isn't already
   ([myaccount.google.com/security](https://myaccount.google.com/security)).
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. Create a new app password (name it anything, e.g. "job-outreach-bot").
4. Google will show you a 16-character password — copy it into `SMTP_PASS` in your
   `.env` file (no spaces).

### 4. Add your resume

Drop your resume PDF into the `data` folder and name it `resume.pdf`, so the final
path is `data/resume.pdf`. (If you'd rather use a different name/location, change
`RESUME_PATH` in `.env` to match.)

### 5. Add your resume highlights

Open `data/resume-highlights.txt` in a text editor and replace its contents with 3–5
sentences describing your background — your skills, what you've built, and what kind
of role you're looking for. This plain text (not the PDF) is what the AI reads to
personalize each email, so the more specific, the better. For example:

```
Full-stack developer with 2 years of experience building web applications in
React and Node.js. Shipped a customer-facing e-commerce platform end-to-end,
from database design to deployment. Comfortable across the stack — REST APIs,
responsive UIs, and CI/CD. Looking for backend or full-stack roles at small,
fast-moving teams.
```

That's it — setup is done.

---

## Running it for the first time

Every command below is run from a terminal, inside the project folder, using
`npm run <command>`. Run them **one at a time**, in this order, and check the results
before moving to the next one.

### Step 1 — Find companies

```bash
npm run discover
```

Searches Google Maps for companies matching your `SEARCH_TERMS` in your
`SEARCH_CITIES`, and adds them to a new spreadsheet file: `data/companies.xlsx`. Open
that file (in Excel, Google Sheets, or LibreOffice Calc) any time to see what's in it.

### Step 2 — Gather contact info

```bash
npm run scrape
```

Visits each new company's website and tries to find a contact email, phone number,
careers page, and open roles. Companies where no email was found are marked
`NoEmailFound` and skipped from here on.

### Step 3 — Draft the outreach messages

```bash
npm run groq-draft
```

Uses AI to write a personalized email, a shorter WhatsApp message, and a follow-up
email for each company that has an email address. **Nothing is sent yet.** Open
`data/companies.xlsx` and read the `EmailSubject` / `EmailBody` columns — this is your
chance to review (and even hand-edit, directly in the spreadsheet) what will be sent.

### Step 4 — Send emails (safely, in review mode)

```bash
npm run send
```

With `AUTOPILOT=false` (the default), this does **not** email real companies — it
sends every drafted email to *your own inbox* instead, with the real subject and body,
so you can see exactly what would have gone out. Check your inbox and make sure the
emails read well.

### Step 5 — Go live

Once you're happy with what you saw in Step 4, open `.env`, set:

```
AUTOPILOT=true
```

save the file, and run `npm run send` again. This time, emails go to the real
companies. From here on, `npm run send` will only email companies that haven't been
emailed yet, so it's always safe to re-run.

### Optional: WhatsApp

```bash
npm run whatsapp
```

The first time you run this, a QR code appears in the terminal — open WhatsApp on your
phone, go to **Settings → Linked Devices → Link a Device**, and scan it. This logs the
bot into your WhatsApp account (the same way WhatsApp Web works in a browser); you
won't need to scan again after that. Like email, this respects `AUTOPILOT`: while
`false`, it only logs what it *would* send (or sends it to `TEST_WHATSAPP_NUMBER` if
you set one).

> **Careful:** automating your personal WhatsApp account is against WhatsApp's Terms
> of Service, and heavy use risks your number being flagged. Keep
> `DAILY_WHATSAPP_CAP` low, and skip this entirely if you'd rather not risk it — the
> tool works fine with email only.

### Everyday use

Once set up, you can just run:

```bash
npm run run-all
```

which does everything above in order (discover → scrape → draft → send → whatsapp →
follow up → back up → report), skipping any company already handled. This is safe to
run daily — it will never re-contact a company it's already reached out to.

### Progress report

```bash
npm run report
```

Generates a PDF into the `reports/` folder with headline numbers, a funnel of how many
companies made it through each stage, and your best-fit companies so far — a
non-technical-friendly summary you can open and read like a document.

---

## Understanding the spreadsheet

`data/companies.xlsx` is the single source of truth — everything the bot knows about
each company lives here, and it's safe to open, read, and even manually edit while the
bot isn't running.

The `Status` column tracks each company through the pipeline:

```
New  ->  EmailFound / NoEmailFound  ->  Emailed  ->  FollowedUp
```

Other useful columns: `Website`, `Email`, `JobTitles`, `TechStack`, `FitScore` (how
good a match the AI thinks this company is), `WhatsAppStatus`, and the drafted
`EmailSubject`/`EmailBody`/`WhatsAppMessage` text. Set a row's `Status` to
`DoNotContact` any time to permanently exclude a company (e.g. if they reply asking not
to be contacted again) — the bot always checks this before doing anything.

A timestamped backup of this file is saved automatically to `data/backups/` before any
risky step, so you can always recover an earlier version.

---

## All commands

```bash
npm run discover     # find companies via Google Maps
npm run scrape        # extract email/phone/careers/tech-stack for new companies
npm run backup        # snapshot companies.xlsx to data/backups/
npm run groq-draft    # draft personalized emails (writes to the sheet, sends nothing)
npm run send          # send drafted emails (see AUTOPILOT above)
npm run followup      # send due follow-up emails
npm run whatsapp      # send drafted WhatsApp messages
npm run run-all       # run the full pipeline end to end
npm run report        # generate a PDF summary report into reports/
```

Every command also accepts, if you want to process only part of the spreadsheet:
- `-- --from=N --to=M` — only rows `N` through `M` (0-based, `M` exclusive), e.g.
  `npm run whatsapp -- --from=0 --to=50`
- `-- --dry-run` — (`discover`/`scrape` only) print what it found without saving

---

## Troubleshooting

- **"Missing required environment variable(s)"** — you haven't filled in every value
  in `.env`. Re-check the table in Setup step 3.
- **Emails fail to send / authentication error** — double check `SMTP_PASS` is a Gmail
  *App Password*, not your regular Gmail password (see Setup step 3).
- **`npm install` fails or hangs** — it downloads a private copy of Chrome, which
  needs a stable connection and roughly 300MB of disk space; try again on better wifi,
  or check if a firewall/proxy is blocking the download.
- **No companies found by `discover`** — try broader `SEARCH_TERMS`, or double-check
  city names in `SEARCH_CITIES` are spelled normally (e.g. `Bangalore`, not `blr`).
- **WhatsApp QR code won't scan / keeps expiring** — make sure your phone has an
  internet connection, and try enlarging your terminal window so the QR code isn't cut
  off.
- **I want to start over** — delete `data/companies.xlsx` (a backup is kept in
  `data/backups/`) and run `npm run discover` again.

---

## Safety & etiquette notes

- This is a rate-limited, personal job-search tool, not a bulk sender — keep
  `DAILY_SEND_CAP` / `DAILY_WHATSAPP_CAP` low and respect opt-out requests.
- Automating a personal WhatsApp account via `whatsapp-web.js` is against WhatsApp's
  Terms of Service for bulk/automated messaging and risks the number being flagged;
  use conservative caps, or skip WhatsApp entirely.
- No ATS auto-apply — the bot detects Greenhouse/Lever/Workable careers pages and
  extracts job titles but does not submit applications on your behalf.
- Always review drafted content (Setup step 3/4) before turning `AUTOPILOT` on.

---

## For developers

### Contributing

Bug fixes, new extractors, and doc improvements are welcome — see
[CONTRIBUTING.md](./CONTRIBUTING.md) for how to get set up and what to keep in mind.

### Testing

```bash
npm test
```

Runs the Vitest suite in `tests/` (extractors, email sending, WhatsApp sending, Excel
storage, backups, Groq drafting, graceful exit) against HTML fixtures in
`tests/fixtures/`.

### Project structure

```
src/
  index.ts               CLI entrypoint and pipeline stages
  config.ts               env var loading/validation
  ai/groq.ts               summarize / score fit / draft email, follow-up, WhatsApp
  scrapers/
    googleMaps.ts          Google Maps company discovery (Puppeteer)
    website.ts              website crawling (Cheerio + Puppeteer fallback)
  extractors/
    email.ts                email extraction/scoring from HTML
    phone.ts                 phone number extraction
    careers.ts               careers page + ATS detection, job title extraction
    techStack.ts              tech stack detection
  email/sender.ts          SMTP sending via Nodemailer
  whatsapp/sender.ts       WhatsApp sending via whatsapp-web.js
  storage/
    excel.ts                 companies.xlsx read/write (source of truth)
    backup.ts                 timestamped backups
  report/                  PDF report generation (Puppeteer-rendered HTML)
  utils/
    logger.ts
    rateLimiter.ts
    gracefulExit.ts           pipeline stage runner + shutdown handling
```

---

## Author

Built by [Arham Sayyed](https://github.com/arham-sayyed) — a personal job-search tool
that turned into an open-source project. If it's useful to you, a star on the repo is
always appreciated!

## License

[MIT](./LICENSE)
