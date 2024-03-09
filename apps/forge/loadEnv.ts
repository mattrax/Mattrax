import { loadEnv } from "vite";
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const monorepoRoot = join(__dirname, "../..");

console.log(monorepoRoot);

process.env = {
	...process.env,
	...loadEnv("production", monorepoRoot, ""),
};

export { monorepoRoot };
