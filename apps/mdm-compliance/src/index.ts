import { Effect, PlatformError, Predicate, Stdio, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { allChecks } from "./checks/index.ts";
import { ScepCaCache } from "./harness/scep.ts";
import { SUITE_VERSION, filterChecks, formatReport, runChecks } from "./runner.ts";
import { PLATFORMS, isCheckCategory, isPlatform } from "./types.ts";
import type { CheckCategory, Platform } from "./types.ts";

const write = (
  stream: "stdout" | "stderr",
  text: string,
): Effect.Effect<void, PlatformError.PlatformError, Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const sink = stream === "stdout" ? stdio.stdout() : stdio.stderr();

    yield* Stream.run(Stream.make(text.endsWith("\n") ? text : `${text}\n`), sink);
  });

const isEpipe = (error: PlatformError.PlatformError): boolean =>
  Predicate.hasProperty(error.reason, "cause") &&
  Predicate.hasProperty(error.reason.cause, "code") &&
  error.reason.cause.code === "EPIPE";

const categories = (value: string): ReadonlyArray<CheckCategory> => {
  if (value === "all") return [];

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.flatMap((category) => {
    if (!isCheckCategory(category)) throw new Error(`Unknown category: ${category}`);

    return [category];
  });
};

const platform = (value: string): ReadonlyArray<Platform> => {
  if (value === "all") return [];

  if (!isPlatform(value)) throw new Error(`Unknown platform: ${value}`);

  return [value];
};

const command = Command.make(
  "mdm-compliance",
  {
    platform: Flag.Literals("platform", ["all", ...PLATFORMS] as const).pipe(
      Flag.withDescription("Only run checks for one protocol"),
      Flag.withDefault("all"),
    ),
    category: Flag.String("category").pipe(
      Flag.withDescription("Only run selected categories (comma separated, default all)"),
      Flag.withDefault("all"),
    ),
    check: Flag.String("check").pipe(
      Flag.withDescription("Substring filter over check id, name, description or category"),
      Flag.withDefault(""),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print a machine-readable JSON report"),
      Flag.withDefault(false),
    ),
    verbose: Flag.Boolean("verbose").pipe(
      Flag.withAlias("v"),
      Flag.withDescription("Show every check description and result"),
      Flag.withDefault(false),
    ),
    list: Flag.Boolean("list").pipe(
      Flag.withDescription("List matching check ids without executing them"),
      Flag.withDefault(false),
    ),
    failFast: Flag.Boolean("fail-fast").pipe(
      Flag.withDescription("Stop after the first failed check"),
      Flag.withDefault(false),
    ),
    timeout: Flag.Int("timeout").pipe(
      Flag.withDescription("Per-check timeout in milliseconds (0 disables)"),
      Flag.withDefault(30_000),
    ),
  },
  Effect.fn(function* (config) {
    let selectedPlatforms: ReadonlyArray<Platform>;
    let selectedCategories: ReadonlyArray<CheckCategory>;

    try {
      selectedPlatforms = platform(config.platform);
      selectedCategories = categories(config.category);
    } catch (error) {
      yield* write("stderr", error instanceof Error ? error.message : String(error));
      yield* Effect.sync(() => {
        process.exitCode = 2;
      });

      return;
    }

    const checks = filterChecks(allChecks, {
      platforms: selectedPlatforms,
      categories: selectedCategories,
      search: config.check,
    });

    if (config.list) {
      for (const item of checks)
        yield* write(
          "stdout",
          `${item.platform.padEnd(8)} ${item.category.padEnd(22)} ${item.dayN ? "day-N" : "base "} ${item.id}  ${item.name}`,
        );
      yield* write("stdout", `${checks.length} checks`);

      return;
    }

    if (checks.length === 0) {
      yield* write("stderr", "No checks matched the selected filters.");
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });

      return;
    }

    if (!config.json)
      yield* write(
        "stdout",
        `Running ${checks.length} compliance checks (${selectedPlatforms.length > 0 ? selectedPlatforms.join(", ") : "apple, windows, android, scep"})...\n`,
      );

    const report = yield* runChecks(checks, {
      platforms: selectedPlatforms,
      categories: selectedCategories,
      search: config.check,
      timeoutMs: config.timeout,
      failFast: config.failFast,
    });

    if (config.json) {
      yield* write("stdout", JSON.stringify(report, null, 2));
    } else {
      yield* write("stdout", formatReport(report, config.verbose));
    }

    if (report.summary.failed > 0)
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
  }),
).pipe(
  Command.withDescription(
    "Emulate Apple, Windows, Android and SCEP MDM devices and verify Mattrax protocol compliance.",
  ),
  Command.withExamples([
    {
      command: "mdm-compliance",
      description: "Run every protocol check",
    },
    {
      command: "mdm-compliance --platform scep --verbose",
      description: "Run SCEP checks with full detail",
    },
    {
      command: "mdm-compliance --check renewal --json",
      description: "Run all day-N renewal checks and emit JSON",
    },
    {
      command: "mdm-compliance --list --category certificates",
      description: "List certificate-related checks",
    },
  ]),
  Command.run({ version: SUITE_VERSION }),
);

command.pipe(
  Effect.catchTag("PlatformError", (error) =>
    isEpipe(error)
      ? Effect.void
      : write("stderr", `I/O error: ${error.message}`).pipe(
          Effect.catch(() => Effect.void),
          Effect.andThen(
            Effect.sync(() => {
              process.exitCode = 1;
            }),
          ),
        ),
  ),
  Effect.provide(ScepCaCache.layer()),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
