import { createEnv } from "@t3-oss/env-core";

export const clientEnv = createEnv({
  clientPrefix: "VITE_",
  client: {},
  runtimeEnvStrict: {},
});
