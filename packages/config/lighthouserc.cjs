/**
 * Lighthouse budgets for the public pages.
 *
 * `pnpm lighthouse` builds the self-host dashboard and serves the built SSR
 * bundle on a production-shaped Node server (see `packages/config/scripts/lighthouse-server.mjs`).
 * Authenticated dashboard routes are intentionally out of scope; the app/auth
 * pages are measured for rendering, accessibility and agentic readiness but not
 * SEO, because robots.txt intentionally excludes them from indexing.
 *
 * Run with one sample per page locally and three in CI.
 */
const budgets = {
  "categories:performance": ["error", { minScore: 0.85 }],
  "categories:accessibility": ["error", { minScore: 1 }],
  "categories:best-practices": ["error", { minScore: 1 }],
  "categories:seo": ["error", { minScore: 1 }],
  "categories:agentic-browsing": ["error", { minScore: 1 }],
  // Core Web Vitals budgets measured on Lighthouse's mobile throttle.
  "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
  "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
  "total-blocking-time": ["error", { maxNumericValue: 500 }],
  "first-contentful-paint": ["error", { maxNumericValue: 2500 }],
  "errors-in-console": ["error", { maxLength: 0 }],
};

module.exports = {
  ci: {
    collect: {
      url: [
        "http://localhost:9050/",
        "http://localhost:9050/login",
        "http://localhost:9050/register",
        "http://localhost:9050/designer",
      ],
      startServerCommand: "node packages/config/scripts/lighthouse-server.mjs",
      startServerReadyPattern: "Lighthouse server ready",
      startServerReadyTimeout: 120000,
      // A single sample keeps the local loop fast; CI medians three runs to
      // damp runner noise.
      numberOfRuns: process.env.CI ? 3 : 1,
      settings: {
        // Lighthouse 13 adds the agentic-browsing category; request it
        // explicitly so the budget below is always collected.
        onlyCategories: [
          "performance",
          "accessibility",
          "best-practices",
          "seo",
          "agentic-browsing",
        ],
        chromeFlags: "--headless=new --no-sandbox --disable-dev-shm-usage",
      },
    },
    assert: {
      assertMatrix: [
        {
          // Public pages, excluding the app/auth routes below.
          matchingUrlPattern: "^(?!.*/(login|register|designer)$).*",
          assertions: budgets,
        },
        {
          // The app and auth pages deliberately carry `noindex`; SEO does not
          // apply to them. Accessibility and agentic readiness still do.
          matchingUrlPattern: ".*/(login|register|designer)$",
          assertions: {
            ...budgets,
            "categories:seo": "off",
            "is-crawlable": "off",
          },
        },
      ],
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
