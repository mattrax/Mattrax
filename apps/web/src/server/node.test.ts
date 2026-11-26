import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findStaticFile } from "./node.js";

vi.mock("node:fs/promises", () => ({ stat: vi.fn() }));

const clientRoot = path.resolve(import.meta.dirname, "../client");
const fileStats = (size = 1): Stats => ({ isFile: () => true, size }) as Stats;

describe("Node static files", () => {
  beforeEach(() => {
    vi.mocked(stat).mockReset();
  });

  it.each([
    "/",
    "/privacy/",
    "/dashboard",
    "/t/acme/devices/device-1",
    "/login",
    "/%64ashboard",
    "/api/v1/bootstrap",
  ])("does not probe dynamic page %s", async (pathname) => {
    await expect(findStaticFile(pathname)).resolves.toBeUndefined();
    expect(stat).not.toHaveBeenCalled();
  });

  it("still probes static files that only share a dynamic prefix", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("missing"));

    await expect(findStaticFile("/login-theme.css")).resolves.toBeUndefined();
    expect(stat).toHaveBeenCalledExactlyOnceWith(path.join(clientRoot, "login-theme.css"));
  });

  it.each([
    {
      pathname: "/docs/getting-started",
      existing: ["index.html", "getting-started", "getting-started.html"],
      expected: "docs/getting-started/index.html",
    },
    {
      pathname: "/guide",
      existing: ["guide", "guide.html"],
      expected: "guide",
    },
    {
      pathname: "/guide",
      existing: ["guide.html"],
      expected: "guide.html",
    },
  ])("selects $expected in asset-layer precedence", async ({ pathname, existing, expected }) => {
    vi.mocked(stat).mockImplementation(async (file) => {
      const name = path.basename(String(file));
      if (!existing.includes(name)) throw new Error("missing");

      return fileStats(existing.indexOf(name) + 1);
    });

    await expect(findStaticFile(pathname)).resolves.toEqual({
      path: path.join(clientRoot, expected),
      size: existing.indexOf(path.basename(expected)) + 1,
    });
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
    releases.get(html!)!({ isFile: () => true, size: 3 } as Stats);
    releases.get(exact!)!({ isFile: () => true, size: 2 } as Stats);
    releases.get(index!)!({ isFile: () => true, size: 1 } as Stats);

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
