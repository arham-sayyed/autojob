import { describe, it, expect } from "vitest";
import { scoreFit } from "../src/ai/groq";

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
