import path from "node:path";
import { loadEnv } from "vite";

const monorepoRoot = path.join(__dirname, "../..");

process.env = {
	...process.env,
	...loadEnv("production", monorepoRoot, ""),
};

export { monorepoRoot };
