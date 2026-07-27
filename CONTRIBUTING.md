# Contributing

Thanks for considering a contribution! This started as a small personal tool, so the
bar for contributing is intentionally low — bug fixes, new extractors (e.g. detecting
another ATS), better email-drafting prompts, docs improvements, and test coverage are
all welcome.

## Getting set up

1. Fork the repo and clone your fork.
2. `npm install`
3. `cp .env.example .env` and fill it in (see the README's Setup section) — you'll
   need this to run the tool end-to-end, though most of the test suite runs offline
   against fixtures and doesn't need real credentials.
4. `npm test` to confirm everything passes before you start.

## Making a change

- Keep pull requests focused — one fix or feature per PR is easier to review than a
  bundle of unrelated changes.
- Match the existing code style: small, single-purpose modules (see `src/extractors/`
  and `src/scrapers/` for the pattern), no unnecessary abstractions, comments only
  where the *why* isn't obvious from the code.
- Add or update tests for any behavior change. Extractors in particular are tested
  against saved HTML fixtures in `tests/fixtures/` — add a new fixture if you're
  handling a new page pattern (a Wantedly/AngelList careers page, a new obfuscation
  style, etc.).
- Before opening a PR, make sure both of these are clean:
  ```bash
  npx tsc --noEmit
  npm test
  ```

## Design principles to respect

This tool automates outreach on someone's behalf, so a few things are non-negotiable
in any contribution:

- **Safe by default.** New send-capable features must respect `AUTOPILOT` the same way
  `email/sender.ts` and `whatsapp/sender.ts` do — redirect to the user when it's
  `false`, never silently send to a third party.
- **Rate-limited, not bulk.** Anything that contacts an external service (email,
  WhatsApp, scraping) should go through the existing rate limiter and cap mechanisms,
  not bypass them for convenience.
- **No silent data loss.** `companies.xlsx` is the single source of truth — changes
  that touch `storage/excel.ts` must stay idempotent (safe to re-run) and must not risk
  corrupting or overwriting rows on a crash (see `utils/gracefulExit.ts`).

## Reporting bugs / suggesting features

Open a GitHub issue with:
- What you expected to happen vs. what actually happened
- Steps to reproduce (a sample company website URL is ideal for extractor bugs — with
  personal data redacted, e.g. from your own test run, not a real target company)
- Your Node.js version and OS

## Code of conduct

Be respectful and constructive in issues and reviews. Disagreements about approach are
fine; personal attacks aren't.
