import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

/** Local compact stand-ins for large generated dependency tables. */
const awsSslProfilesStub = fileURLToPath(new URL("./aws-ssl-profiles.stub.ts", import.meta.url));

const tldtsStub = fileURLToPath(new URL("./tldts.stub.ts", import.meta.url));

const iconvStub = fileURLToPath(new URL("./iconv-lite.stub.ts", import.meta.url));

export default defineConfig({
  // Rolldown's build report feeds @rolldown/perf-kit, which is how the API
  // Worker's startup closure is measured:
  //
  //   pnpm --filter @mattrax/cloud perf:report
  //   pnpm exec perf-kit graph --report node_modules/.rolldown/report/.cloudflare/output/v1/workers/mattrax-api/bundle
  //
  // Opt-in: a normal production build must not emit sourcemaps.
  ...(process.env.MATTRAX_PERF_REPORT === "1"
    ? {
        build: {
          sourcemap: true,
          rolldownOptions: { devtools: { mode: "report" as const } },
        },
      }
    : {}),
  resolve: {
    alias: {
      "aws-ssl-profiles": awsSslProfilesStub,
      tldts: tldtsStub,
      "iconv-lite": iconvStub,
    },
  },
  server: {
    port: 9050,
    allowedHosts: ["dev.otbeaumont.me"],
  },
  plugins: [cloudflare()],
});
