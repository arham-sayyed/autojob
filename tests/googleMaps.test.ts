import { describe, it, expect } from "vitest";
import { isPlausibleWebsite } from "../src/scrapers/googleMaps";

describe("scrapers/googleMaps isPlausibleWebsite", () => {
  it("accepts a normal company website", () => {
    expect(isPlausibleWebsite("https://www.oneture.com/")).toBe(true);
  });

  it("rejects a Google ad-click redirect (the real bug hit in production)", () => {
    expect(
      isPlausibleWebsite(
        "/aclk?sa=l&ai=dchssewig5vaeguqvaxw5eomdhfvkfswyaciccaeqabocc2y&co=1&ase=2&gclid=abc"
      )
    ).toBe(false);
  });

  it("rejects google.com and gstatic.com hosts", () => {
    expect(isPlausibleWebsite("https://www.google.com/aclk?sa=l")).toBe(false);
    expect(isPlausibleWebsite("https://maps.gstatic.com/some/asset")).toBe(false);
  });

  it("rejects null, empty, and non-http(s) URLs", () => {
    expect(isPlausibleWebsite(null)).toBe(false);
    expect(isPlausibleWebsite("")).toBe(false);
    expect(isPlausibleWebsite("tel:+919876543210")).toBe(false);
    expect(isPlausibleWebsite("not a url")).toBe(false);
  });
});
