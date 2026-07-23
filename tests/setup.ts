// Ensures `npm test` works on a fresh checkout without a real .env — these
// are dummy values only used so config.ts's validation doesn't throw while
// importing modules under test. dotenv.config() (called by src/config.ts)
// never overwrites already-set process.env vars, so a real local .env (if
// present) still wins for anything actually exercising these values.
process.env.GROQ_API_KEY ??= "test-groq-api-key";
process.env.SMTP_HOST ??= "smtp.example.com";
process.env.SMTP_PORT ??= "465";
process.env.SMTP_USER ??= "test@example.com";
process.env.SMTP_PASS ??= "test-pass";
process.env.RESUME_PATH ??= "./data/resume.pdf";
process.env.DAILY_SEND_CAP ??= "25";
process.env.DAILY_WHATSAPP_CAP ??= "25";
process.env.FOLLOW_UP_AFTER_DAYS ??= "7";
process.env.SEARCH_CITIES ??= "Pune";
process.env.SEARCH_TERMS ??= "software company";
process.env.AUTOPILOT ??= "false";
