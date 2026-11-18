import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

/** Local compact stand-ins for large generated dependency tables. */
const awsSslProfilesStub = fileURLToPath(new URL("./aws-ssl-profiles.stub.ts", import.meta.url));

const tldtsStub = fileURLToPath(new URL("./tldts.stub.ts", import.meta.url));

const iconvStub = fileURLToPath(new URL("./iconv-lite.stub.ts", import.meta.url));

export default defineConfig({
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
