import type { Stats } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { findStaticFile } from "./node.js";

const clientRoot = path.resolve(import.meta.dirname, "../client");
const fileStats = (size = 1): Stats => ({ isFile: () => true, size }) as Stats;
const missing = (): never => {
  throw new Error("missing");
};

/** Injected `stat`: a recording fake instead of a module mock of node:fs/promises. */
let statCalls: string[] = [];
let statImpl: (file: string) => Promise<Stats> = async () => missing();
const stat = (file: string): Promise<Stats> => {
  statCalls.push(String(file));

  return statImpl(file);
};

describe("Node static files", () => {
  beforeEach(() => {
    statCalls = [];
    statImpl = async () => missing();
  });

  describe("dynamic pages", () => {
    const paths = [
      "/",
      "/privacy/",
      "/dashboard",
      "/t/acme/devices/device-1",
      "/login",
      "/%64ashboard",
      "/api/v1/bootstrap",
    ];

    for (const pathname of paths) {
      it(`does not probe ${pathname}`, async () => {
        await expect(findStaticFile(pathname, stat)).resolves.toBeUndefined();
        expect(statCalls).toEqual([]);
      });
    }
  });

  it("still probes static files that only share a dynamic prefix", async () => {
    await expect(findStaticFile("/login-theme.css", stat)).resolves.toBeUndefined();
    expect(statCalls).toEqual([path.join(clientRoot, "login-theme.css")]);
  });

  describe("asset-layer precedence", () => {
    const cases = [
      {
        name: "an index sibling for a docs page",
        pathname: "/docs/getting-started",
        existing: ["index.html", "getting-started", "getting-started.html"],
        expected: "docs/getting-started/index.html",
      },
      {
        name: "an exact file over its html sibling",
        pathname: "/guide",
        existing: ["guide", "guide.html"],
        expected: "guide",
      },
      {
        name: "an html sibling when no exact file exists",
        pathname: "/guide",
        existing: ["guide.html"],
        expected: "guide.html",
      },
    ];

    for (const { name, pathname, existing, expected } of cases) {
      it(name, async () => {
        statImpl = async (file) => {
          const basename = path.basename(String(file));

          if (!existing.includes(basename)) return missing();

          return fileStats(existing.indexOf(basename) + 1);
        };

        await expect(findStaticFile(pathname, stat)).resolves.toEqual({
          path: path.join(clientRoot, expected),
          size: existing.indexOf(path.basename(expected)) + 1,
        });
      });
    }
  });

  it("probes candidates concurrently without changing docs precedence", async () => {
    const releases = new Map<string, (stats: Stats) => void>();
    statImpl = (file) =>
      new Promise<Stats>((resolve) => {
        releases.set(String(file), resolve);
      });
    const result = findStaticFile("/guide", stat);
    const [index, exact, html] = statCalls;

    expect(statCalls).toHaveLength(3);
    expect(index).toBe(path.join(clientRoot, "guide/index.html"));
    expect(exact).toBe(path.join(clientRoot, "guide"));
    expect(html).toBe(path.join(clientRoot, "guide.html"));
    releases.get(html!)!(fileStats(3));
    releases.get(exact!)!(fileStats(2));
    releases.get(index!)!(fileStats(1));

    await expect(result).resolves.toEqual({ path: index, size: 1 });
  });

  it("probes an exact static asset only once", async () => {
    statImpl = async () => fileStats(42);

    await expect(findStaticFile("/assets/app.js", stat)).resolves.toEqual({
      path: path.join(clientRoot, "assets/app.js"),
      size: 42,
    });
    expect(statCalls).toHaveLength(1);
  });
});
