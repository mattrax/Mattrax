import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const distDir = join(rootDir, "dist");

mkdirSync(distDir, { recursive: true });

// 1. Bundle the application with esbuild
console.log("Bundling application...");
await esbuild.build({
  entryPoints: [join(rootDir, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  outfile: join(distDir, "server.cjs"),
  format: "cjs",
  define: {
    "process.env.MATTRAX_SERVER_BUNDLED": '"1"',
  },
});

// 2. Create the SEA configuration
const seaConfigPath = join(distDir, "sea-config.json");
const seaConfig = {
  main: join(distDir, "server.cjs"),
  output: join(distDir, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
};
writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

// 3. Generate the SEA blob
console.log("Generating SEA blob...");
execSync(`node --experimental-sea-config "${seaConfigPath}"`, {
  stdio: "inherit",
});

// 4. Copy the Node binary
const nodePath = execSync("command -v node", { encoding: "utf-8" }).trim();
const binaryPath = join(distDir, "mttx");
console.log(`Copying Node binary from ${nodePath}...`);
copyFileSync(nodePath, binaryPath);

// 5. Inject the blob into the copied binary
console.log("Injecting SEA blob into binary...");
const postjectPath = join(rootDir, "node_modules", ".bin", "postject");
const sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const args = [
  binaryPath,
  "NODE_SEA_BLOB",
  join(distDir, "sea-prep.blob"),
  "--sentinel-fuse",
  sentinelFuse,
  "--macho-segment-name",
  "NODE_SEA",
];

try {
  execSync(`${postjectPath} ${args.map((a) => `"${a}"`).join(" ")}`, {
    stdio: "inherit",
  });
} catch (error) {
  console.warn("postject injection may have failed. Trying with npx...");
  execSync(`npx postject ${args.map((a) => `"${a}"`).join(" ")}`, {
    stdio: "inherit",
  });
}

// 6. Ad-hoc sign the binary on macOS (required after modifying a copied Node binary)
if (process.platform === "darwin") {
  console.log("Ad-hoc signing binary for macOS...");
  execSync(`codesign --sign - --force --preserve-metadata=entitlements,requirements,flags,runtime "${binaryPath}"`, {
    stdio: "inherit",
  });
}

console.log(`SEA binary created at: ${binaryPath}`);
