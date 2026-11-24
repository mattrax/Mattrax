import type { ScriptTrigger } from "@mattrax/enterprise-domain/client";

/**
 * Options for the script editor's design-system selects.
 *
 * Keeping the values and labels here means the pickers, hints and tests agree
 * on the supported shells, run-as modes and schedules.
 */
export type ScriptLanguage = "bash" | "zsh" | "sh" | "pwsh";

export type ScriptRunAs = "root" | "user";

export type ScriptSelectOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
};

export const SCRIPT_LANGUAGE_OPTIONS: ReadonlyArray<ScriptSelectOption<ScriptLanguage>> = [
  { value: "bash", label: "bash" },
  { value: "zsh", label: "zsh" },
  { value: "sh", label: "sh" },
  { value: "pwsh", label: "PowerShell" },
];

export const SCRIPT_RUN_AS_OPTIONS: ReadonlyArray<ScriptSelectOption<ScriptRunAs>> = [
  { value: "user", label: "Logged-in user" },
  { value: "root", label: "root" },
];

export const SCRIPT_TRIGGER_OPTIONS: ReadonlyArray<ScriptSelectOption<ScriptTrigger["type"]>> = [
  { value: "manual", label: "Manual only" },
  { value: "install", label: "When the profile is installed" },
  { value: "login", label: "User login" },
  { value: "logout", label: "User logout" },
  { value: "network-change", label: "Network change" },
  { value: "interval", label: "Every interval" },
  { value: "cron", label: "Cron schedule" },
];
