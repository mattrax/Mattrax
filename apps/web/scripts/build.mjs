import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = join(__dirname, "..");
const repoRoot = join(appDir, "..", "..");
const docsDir = join(repoRoot, "docs");
const distDir = join(appDir, "dist");
const docsDistDir = join(docsDir, ".vitepress", "dist");
const targetDocsDir = join(distDir, "docs");

// 1. Typecheck web app
console.log("Typechecking web app...");
execSync("tsc", { cwd: appDir, stdio: "inherit" });

// 2. Build web app
console.log("Building web app...");
execSync("vp build", { cwd: appDir, stdio: "inherit" });

// 3. Build docs from repo root to avoid vite resolution conflicts
console.log("Building docs...");
execSync("vitepress build docs", { cwd: repoRoot, stdio: "inherit" });

// 4. Copy docs dist into web dist
console.log("Copying docs into web dist...");
rmSync(targetDocsDir, { recursive: true, force: true });
cpSync(docsDistDir, targetDocsDir, { recursive: true });

console.log("Build complete!");
