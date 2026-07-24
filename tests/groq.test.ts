import { describe, it, expect } from "vitest";
import { scoreFit, parseSubjectBody } from "../src/ai/groq";

describe("ai/groq scoreFit (rules-based, deterministic)", () => {
  it("scores 0 for a non-hiring, non-matching company", () => {
    expect(
      scoreFit({ jobTitles: [], ats: "none", techStack: [], pageText: "We build widgets." })
    ).toBe(0);
  });

  it("adds 25 for hiring signal via ATS", () => {
    expect(
      scoreFit({ jobTitles: [], ats: "greenhouse", techStack: [], pageText: "" })
    ).toBe(25);
  });

  it("adds 25 for hiring signal via job titles even with ats none", () => {
    expect(
      scoreFit({ jobTitles: ["Backend Engineer"], ats: "none", techStack: [], pageText: "" })
    ).toBe(25);
  });

  it("adds 20 for a 'remote' mention in page text", () => {
    expect(
      scoreFit({ jobTitles: [], ats: "none", techStack: [], pageText: "We are a remote-first team." })
    ).toBe(20);
  });

  it("adds 10 per matched stack technology", () => {
    expect(
      scoreFit({ jobTitles: [], ats: "none", techStack: ["React", "Next.js", "Django"], pageText: "" })
    ).toBe(20);
  });

  it("adds 15 for junior/internship-friendly signals", () => {
    expect(
      scoreFit({ jobTitles: ["Software Engineering Intern"], ats: "none", techStack: [], pageText: "" })
    ).toBe(25 + 15); // hiring (job title present) + junior-friendly
  });

  it("sums all applicable bonuses", () => {
    const score = scoreFit({
      jobTitles: ["Junior Backend Engineer"],
      ats: "lever",
      techStack: ["React", "TypeScript"],
      pageText: "We're a remote-first company hiring across India.",
    });
    // hiring(25) + remote(20) + stack(2*10=20) + junior(15)
    expect(score).toBe(80);
  });
});

describe("ai/groq parseSubjectBody", () => {
  it("parses a well-formed response", () => {
    const raw = "Subject: Interested in joining Acme\n\nHi there,\n\nI'd love to join.\n\nBest,";
    expect(parseSubjectBody(raw, "fallback")).toEqual({
      subject: "Interested in joining Acme",
      body: "Hi there,\n\nI'd love to join.\n\nBest,",
    });
  });

  it("tolerates a preamble before the Subject: line", () => {
    // Regression: the old ^-anchored regex failed on any preamble, dumping
    // the whole raw response (Subject: line included) into the body.
    const raw = "Here's the email:\n\nSubject: Interested in joining Acme\n\nHi there,\n\nBest,";
    expect(parseSubjectBody(raw, "fallback")).toEqual({
      subject: "Interested in joining Acme",
      body: "Hi there,\n\nBest,",
    });
  });

  it("strips a markdown code fence wrapping the response", () => {
    const raw = "```\nSubject: Interested in joining Acme\n\nHi there,\n\nBest,\n```";
    expect(parseSubjectBody(raw, "fallback")).toEqual({
      subject: "Interested in joining Acme",
      body: "Hi there,\n\nBest,",
    });
  });

  it("falls back to the given subject when no Subject: line is present at all", () => {
    const raw = "Hi there, I'd love to join your team.\n\nBest,";
    expect(parseSubjectBody(raw, "fallback subject")).toEqual({
      subject: "fallback subject",
      body: raw,
    });
  });
});
