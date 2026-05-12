import { createEnv } from "@t3-oss/env-core";
import { vite } from "@t3-oss/env-core/presets-valibot";
import { env } from "cloudflare:workers";
import * as v from "valibot";

export const serverEnv = createEnv({
  server: {
    BETTER_AUTH_SECRET: v.pipe(
      v.string(),
      v.minLength(32, "The string must be 32 or more characters long."),
    ),
    BETTER_AUTH_URL: v.pipe(v.string(), v.url("Must be a valid URL")),
  },
  onValidationError: (issues) => {
    throw new Error(
      `Environment validation failed: ${issues.map((i) => `- ${i.message}`).join("\n")}`,
    );
  },
  extends: [vite()],
  runtimeEnv: env as any,
});
