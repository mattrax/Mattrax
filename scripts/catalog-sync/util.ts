import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as tar from "tar";

const RETRIES = 3;
const RETRY_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 60_000;

/** A recoverable failure while fetching or parsing an upstream source. */
export class SourceError extends Error {
  readonly source: string;
  readonly detail: string;

  constructor(source: string, detail: string, cause?: unknown) {
    super(`${source}: ${detail}`, { cause });
    this.name = "SourceError";
    this.source = source;
    this.detail = detail;
  }
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const withRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < RETRIES) await wait(RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
};

const fetchResponse = (url: string, source: string = url): Promise<Response> =>
  withRetry(async () => {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) throw new SourceError(source, `HTTP ${response.status}`);

    return response;
  });

export const fetchArrayBuffer = async (url: string, source: string = url): Promise<ArrayBuffer> => {
  const response = await fetchResponse(url, source);

  try {
    return await response.arrayBuffer();
  } catch (cause) {
    throw new SourceError(source, "failed to read body", cause);
  }
};

export const fetchText = async (url: string, source: string = url): Promise<string> => {
  const response = await fetchResponse(url, source);

  try {
    return await response.text();
  } catch (cause) {
    throw new SourceError(source, "failed to read body", cause);
  }
};

/** Parsed JSON is untrusted vendor data; callers narrow the result themselves. */
export const fetchJson = async (url: string, source: string = url): Promise<unknown> => {
  const text = await fetchText(url, source);

  try {
    // SAFETY: JSON.parse returns the document the caller narrows; the only
    // guarantee here is that the body parsed, which the catch reports.
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new SourceError(source, "invalid JSON", cause);
  }
};

/** Run `use` with a fresh temp directory that is always cleaned up. */
export const withTempDir = async <T>(use: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "mattrax-catalog-"));

  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * Download a gzipped tarball and extract it into `dir`. The archive contains a
 * single top-level directory (GitHub's `repo-ref/`); its path is returned.
 */
export const downloadTarball = async (
  url: string,
  dir: string,
  source: string = url,
): Promise<string> => {
  const file = join(dir, "source.tgz");
  const bytes = await fetchArrayBuffer(url, source);

  await writeFile(file, new Uint8Array(bytes));

  try {
    await Promise.resolve(tar.x({ file, cwd: dir }));
  } catch (cause) {
    throw new SourceError(source, "failed to extract tarball", cause);
  }

  const entries = await readdir(dir);
  const root = entries.find((entry) => entry !== "source.tgz");

  if (!root) throw new SourceError(source, "tarball was empty");

  return join(dir, root);
};

/** Recursively list files under `dir` whose path matches `matches`. */
export const listFiles = async (
  dir: string,
  matches: (path: string) => boolean,
): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) out.push(...(await listFiles(path, matches)));
    else if (matches(path)) out.push(path);
  }

  return out;
};

export const readFileText = (path: string): Promise<string> => readFile(path, "utf8");

/** Decode the handful of HTML entities that appear in vendor prose. */
export const decodeEntities = (text: string): string =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");

/** Normalise vendor prose: strip tags, decode entities, collapse space. */
export const cleanText = (input: string | number | boolean | null | undefined, max = 4000): string => {
  if (!input) return "";

  let text = decodeEntities(String(input));

  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\r\n?/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  if (text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;

  return text;
};

export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Write pretty-printed JSON, creating parent directories as needed. */
export const writeJson = async <T>(path: string, value: T): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

/** Map with a fixed number of concurrent workers, preserving input order. */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = Array.from<R>({ length: items.length });
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);

  await Promise.all(workers);

  return results;
};
