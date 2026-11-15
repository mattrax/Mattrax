export const PLATFORMS = ["apple", "windows", "android", "scep"] as const;

export type Platform = (typeof PLATFORMS)[number];

export type CheckCategory =
  | "enrollment"
  | "check-in"
  | "commands"
  | "declarative-management"
  | "management"
  | "certificates"
  | "authentication"
  | "policy"
  | "notifications"
  | "day-n"
  | "errors";

export type Check = {
  readonly id: string;
  readonly platform: Platform;
  readonly category: CheckCategory;
  readonly name: string;
  readonly description: string;
  readonly dayN?: boolean;
  readonly run: () => Promise<void>;
};

export type CheckStatus = "passed" | "failed" | "skipped";

export type CheckResult = {
  readonly id: string;
  readonly platform: Platform;
  readonly category: CheckCategory;
  readonly name: string;
  readonly description: string;
  readonly dayN: boolean;
  readonly status: CheckStatus;
  readonly durationMs: number;
  readonly error?: string;
};

export type RunOptions = {
  readonly platforms?: ReadonlyArray<Platform>;
  readonly categories?: ReadonlyArray<CheckCategory>;
  readonly search?: string;
  readonly timeoutMs?: number;
  readonly failFast?: boolean;
};

export type RunSummary = {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly byPlatform: Record<Platform, { total: number; passed: number; failed: number }>;
};

export type RunReport = {
  readonly suite: "mdm-compliance";
  readonly version: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly summary: RunSummary;
  readonly checks: ReadonlyArray<CheckResult>;
};

export const isPlatform = (value: string): value is Platform =>
  PLATFORMS.some((platform) => platform === value);

export const CHECK_CATEGORIES = [
  "enrollment",
  "check-in",
  "commands",
  "declarative-management",
  "management",
  "certificates",
  "authentication",
  "policy",
  "notifications",
  "day-n",
  "errors",
] as const satisfies ReadonlyArray<CheckCategory>;

export const isCheckCategory = (value: string): value is CheckCategory =>
  CHECK_CATEGORIES.some((category) => category === value);
