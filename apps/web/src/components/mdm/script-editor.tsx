import {
  Select,
  SelectChevron,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
} from "@mattrax/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ErrorText, Field, Panel } from "~/components/mdm/common";
import type { ScriptEnvironmentEntry, ScriptTrigger } from "@mattrax/enterprise-domain/client";
import {
  SCRIPT_LANGUAGE_OPTIONS,
  SCRIPT_RUN_AS_OPTIONS,
  SCRIPT_TRIGGER_OPTIONS,
} from "~/lib/script-editor-options";
import type { ScriptLanguage, ScriptRunAs } from "~/lib/script-editor-options";

const textareaClass =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30";

export type ScriptDraftValues = {
  name: string;
  description: string;
  language: ScriptLanguage;
  body: string;
  runAs: ScriptRunAs;
  timeoutSeconds: number;
  environment: ScriptEnvironmentEntry[];
  trigger: ScriptTrigger;
};

export const emptyScriptDraft = (): ScriptDraftValues => ({
  name: "",
  description: "",
  language: "bash",
  body: "#!/bin/bash\n\n",
  runAs: "user",
  timeoutSeconds: 300,
  environment: [],
  trigger: { type: "manual", intervalSeconds: null, cronExpression: null },
});

/** Operator-facing description of how mattraxd runs a script. */
const runAsHint = (runAs: ScriptRunAs) =>
  runAs === "root"
    ? "Runs as root. The device must have mattraxd installed as a LaunchDaemon."
    : "Runs as the logged-in console user. Timer and install triggers run without a console user and are skipped.";

const languageHint = (language: ScriptLanguage) =>
  language === "pwsh" ? "PowerShell requires mattraxd on Windows." : `Uses /bin/${language}.`;

/**
 * Shared script editor. The new page and the detail page submit the same shape,
 * so validation hints and limits stay identical in both places.
 */
export function ScriptEditor(props: {
  /** Stable script id; a refetch keeps the same value, a route change does not. */
  identity?: string;
  initial?: ScriptDraftValues;
  submitLabel: string;
  saving: boolean;
  error?: unknown;
  disabled?: boolean;
  onSubmit: (values: ScriptDraftValues) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = createSignal<ScriptDraftValues>(props.initial ?? emptyScriptDraft());

  const [environment, setEnvironment] = createSignal<ScriptEnvironmentEntry[]>(
    props.initial?.environment ?? [],
  );

  // Seed once per script. The detail page passes a fresh object after every
  // refetch, and reseeding then discarded unsaved body/environment edits.
  let seededIdentity: string | undefined;

  createEffect(
    () => ({ identity: props.identity, initial: props.initial }),
    ({ identity, initial }) => {
      if (seededIdentity === identity || !initial) return;

      seededIdentity = identity;
      setDraft({ ...initial, environment: [...initial.environment] });
      setEnvironment([...initial.environment]);
    },
  );

  const patch = (values: Partial<ScriptDraftValues>) =>
    setDraft((current) => ({ ...current, ...values }));

  const changeTrigger = (type: ScriptTrigger["type"]) => {
    const current = draft().trigger;

    patch({
      trigger: {
        type,
        intervalSeconds: type === "interval" ? (current.intervalSeconds ?? 3600) : null,
        cronExpression: type === "cron" ? (current.cronExpression ?? "0 * * * *") : null,
      },
    });
  };

  const updateEnvironment = (index: number, values: Partial<ScriptEnvironmentEntry>) =>
    setEnvironment((rows) => rows.map((row, i) => (i === index ? { ...row, ...values } : row)));

  return (
    <form
      class="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit({ ...draft(), environment: environment() });
      }}
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            required
            maxlength={120}
            value={draft().name}
            disabled={props.disabled}
            onInput={(event) => patch({ name: event.currentTarget.value })}
            placeholder="e.g. Rotate logs"
          />
        </Field>
        <Field label="Schedule">
          <Select
            items={SCRIPT_TRIGGER_OPTIONS}
            value={draft().trigger.type}
            disabled={props.disabled}
            onValueChange={(value: string | null) => {
              // SAFETY: the list only contains trigger literals.
              if (value) changeTrigger(value as ScriptTrigger["type"]);
            }}
          >
            <SelectTrigger aria-label="Schedule" class="h-9">
              <SelectValue />
              <SelectChevron />
            </SelectTrigger>
            <SelectContent>
              <For each={SCRIPT_TRIGGER_OPTIONS}>
                {(option) => <SelectItem value={option.value}>{option.label}</SelectItem>}
              </For>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Show when={draft().trigger.type === "interval"}>
        <Field label="Interval (seconds)" hint="Minimum 60 seconds; maximum 30 days.">
          <Input
            type="number"
            min={60}
            max={2_592_000}
            required
            value={draft().trigger.intervalSeconds ?? 3600}
            disabled={props.disabled}
            onInput={(event) =>
              patch({
                trigger: {
                  ...draft().trigger,
                  intervalSeconds: Number(event.currentTarget.value),
                },
              })
            }
          />
        </Field>
      </Show>

      <Show when={draft().trigger.type === "cron"}>
        <Field
          label="Cron expression"
          hint="Five fields: minute hour day-of-month month day-of-week. Evaluated on the device."
        >
          <Input
            required
            value={draft().trigger.cronExpression ?? "0 * * * *"}
            disabled={props.disabled}
            onInput={(event) =>
              patch({
                trigger: { ...draft().trigger, cronExpression: event.currentTarget.value },
              })
            }
            placeholder="0 3 * * *"
          />
        </Field>
      </Show>

      <div class="grid gap-4 sm:grid-cols-3">
        <Field label="Shell" hint={languageHint(draft().language)}>
          <Select
            items={SCRIPT_LANGUAGE_OPTIONS}
            value={draft().language}
            disabled={props.disabled}
            onValueChange={(value: string | null) => {
              // SAFETY: the list only contains supported shells.
              if (value) patch({ language: value as ScriptLanguage });
            }}
          >
            <SelectTrigger aria-label="Shell" class="h-9">
              <SelectValue />
              <SelectChevron />
            </SelectTrigger>
            <SelectContent>
              <For each={SCRIPT_LANGUAGE_OPTIONS}>
                {(option) => <SelectItem value={option.value}>{option.label}</SelectItem>}
              </For>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Run as" hint={runAsHint(draft().runAs)}>
          <Select
            items={SCRIPT_RUN_AS_OPTIONS}
            value={draft().runAs}
            disabled={props.disabled}
            onValueChange={(value: string | null) => {
              // SAFETY: the list only contains supported run-as modes.
              if (value) patch({ runAs: value as ScriptRunAs });
            }}
          >
            <SelectTrigger aria-label="Run as" class="h-9">
              <SelectValue />
              <SelectChevron />
            </SelectTrigger>
            <SelectContent>
              <For each={SCRIPT_RUN_AS_OPTIONS}>
                {(option) => <SelectItem value={option.value}>{option.label}</SelectItem>}
              </For>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Timeout (seconds)" hint="mattraxd stops the script at this deadline.">
          <Input
            type="number"
            min={1}
            max={86_400}
            required
            value={draft().timeoutSeconds}
            disabled={props.disabled}
            onInput={(event) => patch({ timeoutSeconds: Number(event.currentTarget.value) })}
          />
        </Field>
      </div>

      <Field label="Description">
        <Input
          maxlength={2000}
          value={draft().description}
          disabled={props.disabled}
          onInput={(event) => patch({ description: event.currentTarget.value })}
          placeholder="What this script does and why"
        />
      </Field>

      <Field label="Script body" hint="Maximum 32 KiB. Stored and delivered verbatim.">
        <textarea
          required
          rows={16}
          spellcheck={false}
          class={textareaClass}
          value={draft().body}
          disabled={props.disabled}
          onInput={(event) => patch({ body: event.currentTarget.value })}
        />
      </Field>

      <Panel
        title="Environment"
        description="Exported to the script. Secret values are redacted from captured output."
      >
        <div class="space-y-2">
          <For each={environment()}>
            {(entry, index) => (
              <div class="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Environment variable name"
                  class="w-40"
                  value={entry.name}
                  disabled={props.disabled}
                  placeholder="NAME"
                  onInput={(event) =>
                    updateEnvironment(index(), { name: event.currentTarget.value })
                  }
                />
                <Input
                  aria-label="Environment variable value"
                  class="min-w-0 flex-1"
                  value={entry.value}
                  disabled={props.disabled}
                  placeholder="value"
                  onInput={(event) =>
                    updateEnvironment(index(), { value: event.currentTarget.value })
                  }
                />
                <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    class="size-3.5"
                    checked={entry.secret}
                    disabled={props.disabled}
                    onCheckedChange={(checked) =>
                      updateEnvironment(index(), { secret: checked === true })
                    }
                  />
                  Secret
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={props.disabled}
                  onClick={() => setEnvironment((rows) => rows.filter((_, i) => i !== index()))}
                >
                  Remove
                </Button>
              </div>
            )}
          </For>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.disabled || environment().length >= 32}
            onClick={() =>
              setEnvironment((rows) => [...rows, { name: "", value: "", secret: false }])
            }
          >
            Add variable
          </Button>
        </div>
      </Panel>

      <Show when={props.error}>
        <ErrorText error={props.error} />
      </Show>

      <div class="flex items-center gap-2">
        <Button type="submit" disabled={props.disabled || props.saving}>
          {props.saving ? "Saving…" : props.submitLabel}
        </Button>
        <Show when={props.onCancel}>
          <Button type="button" variant="ghost" onClick={() => props.onCancel?.()}>
            Cancel
          </Button>
        </Show>
      </div>
    </form>
  );
}
