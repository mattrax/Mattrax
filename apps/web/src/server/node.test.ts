import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findStaticFile } from "./node.js";

vi.mock("node:fs/promises", () => ({ stat: vi.fn() }));

const clientRoot = path.resolve(import.meta.dirname, "../client");
const fileStats = (size = 1): Stats => ({ isFile: () => true, size }) as Stats;
const missing = (): never => {
  throw new Error("missing");
};

describe("Node static files", () => {
  beforeEach(() => {
    vi.mocked(stat).mockReset();
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
        await expect(findStaticFile(pathname)).resolves.toBeUndefined();
        expect(stat).not.toHaveBeenCalled();
      });
    }
  });

  it("still probes static files that only share a dynamic prefix", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("missing"));

    await expect(findStaticFile("/login-theme.css")).resolves.toBeUndefined();
    expect(stat).toHaveBeenCalledExactlyOnceWith(path.join(clientRoot, "login-theme.css"));
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
        vi.mocked(stat).mockImplementation(async (file) => {
          const basename = path.basename(String(file));

          if (!existing.includes(basename)) return missing();

          return fileStats(existing.indexOf(basename) + 1);
        });

        await expect(findStaticFile(pathname)).resolves.toEqual({
          path: path.join(clientRoot, expected),
          size: existing.indexOf(path.basename(expected)) + 1,
        });
      });
    }
  });

  it("probes candidates concurrently without changing docs precedence", async () => {
    const releases = new Map<string, (stats: Stats) => void>();
    vi.mocked(stat).mockImplementation(
      (file) =>
        new Promise<Stats>((resolve) => {
          releases.set(String(file), resolve);
        }),
    );
    const result = findStaticFile("/guide");
    const [index, exact, html] = vi.mocked(stat).mock.calls.map(([file]) => String(file));

    expect(stat).toHaveBeenCalledTimes(3);
    expect(index).toBe(path.join(clientRoot, "guide/index.html"));
    expect(exact).toBe(path.join(clientRoot, "guide"));
    expect(html).toBe(path.join(clientRoot, "guide.html"));
    releases.get(html!)!(fileStats(3));
    releases.get(exact!)!(fileStats(2));
    releases.get(index!)!(fileStats(1));

    await expect(result).resolves.toEqual({ path: index, size: 1 });
  });

  it("probes an exact static asset only once", async () => {
    vi.mocked(stat).mockResolvedValue(fileStats(42));

    await expect(findStaticFile("/assets/app.js")).resolves.toEqual({
      path: path.join(clientRoot, "assets/app.js"),
      size: 42,
    });
    expect(stat).toHaveBeenCalledTimes(1);
  });
});
