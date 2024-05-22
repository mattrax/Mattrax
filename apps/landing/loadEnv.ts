import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

const monorepoRoot = join(__dirname, "../..");

process.env = {
	...process.env,
	...loadEnv("production", monorepoRoot, ""),
};

export { monorepoRoot };
