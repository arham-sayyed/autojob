import * as cheerio from "cheerio";

interface Fingerprint {
  name: string;
  test: (html: string, $: cheerio.CheerioAPI) => boolean;
}

const FINGERPRINTS: Fingerprint[] = [
  {
    name: "Next.js",
    test: (html) => /__NEXT_DATA__/.test(html) || /\/_next\//.test(html),
  },
  {
    name: "React",
    test: (html, $) =>
      $("[data-reactroot]").length > 0 ||
      /data-reactroot/.test(html) ||
      /react(-dom)?[.\-]/i.test(html),
  },
  {
    name: "Angular",
    test: (html, $) => $("[ng-version]").length > 0 || /ng-version/.test(html),
  },
  {
    name: "Vue",
    test: (html) =>
      /__VUE__/.test(html) || /Vue\.config/.test(html) || /data-v-[a-z0-9]{6,10}/.test(html),
  },
  {
    name: "Svelte",
    test: (html) => /svelte-[a-z0-9]+/.test(html),
  },
  {
    name: "jQuery",
    test: (html) => /jquery(\.min)?\.js/i.test(html),
  },
  {
    name: "WordPress",
    test: (html) => /wp-content|wp-includes/.test(html),
  },
  {
    name: "Webflow",
    test: (html) => /webflow\.js|data-wf-site/.test(html),
  },
];

/**
 * Sniffs <script> tags and general page source for common framework
 * fingerprints. Returns the list of names detected (order = FINGERPRINTS order).
 */
export function detectTechStack(html: string): string[] {
  const $ = cheerio.load(html);
  const found: string[] = [];
  for (const fp of FINGERPRINTS) {
    if (fp.test(html, $)) found.push(fp.name);
  }
  return found;
}

export function techStackToString(names: string[]): string {
  return names.join(",");
}
