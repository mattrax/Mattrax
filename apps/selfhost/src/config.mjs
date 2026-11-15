import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Read the deployment configuration written by `cf build`
 * (`worker.config.json`) so the self-hosted runtime follows
 * `cloudflare.config.ts` instead of drifting from it.
 */
export const readWorkerConfig = async (directory) => {
  const raw = await readFile(path.join(directory, "worker.config.json"), "utf8");

  return { directory, config: JSON.parse(raw) };
};

export const findBinding = (config, type) =>
  Object.entries(config.env ?? {}).find(([, spec]) => spec.type === type);
