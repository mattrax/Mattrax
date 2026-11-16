/**
 * Lighthouse CI budgets for the public pages.
 *
 * Run with `pnpm lighthouse` (one sample per page locally, three in CI).
 * The configuration starts the real dev server so the run needs no deployed
 * environment; authenticated dashboard routes are intentionally out of scope.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        "http://localhost:9050/",
        "http://localhost:9050/login",
        "http://localhost:9050/register",
        "http://localhost:9050/designer",
      ],
      startServerCommand: "pnpm web dev",
      startServerReadyPattern: "localhost:9050",
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
      assertions: {
        "categories:performance": ["error", { minScore: 1 }],
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["error", { minScore: 1 }],
        "categories:seo": ["error", { minScore: 1 }],
        "categories:agentic-browsing": ["error", { minScore: 1 }],
        // Core Web Vitals budgets measured on Lighthouse's mobile throttle.
        "largest-contentful-paint": ["error", { maxNumericValue: 1500 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.01 }],
        "total-blocking-time": ["error", { maxNumericValue: 150 }],
        "first-contentful-paint": ["error", { maxNumericValue: 1200 }],
        "errors-in-console": ["error", { maxLength: 0 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
    },
  },
};
