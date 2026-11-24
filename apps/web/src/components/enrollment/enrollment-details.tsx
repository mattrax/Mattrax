import { createSignal, For, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { EnrollmentNotice } from "./enrollment-feedback";
import type { EnrollmentResponse } from "~/lib/enterprise";
import { submitPublicEnrollmentAnswers } from "~/lib/enrollment.server";

const attributeInputType = (type: string): "text" | "number" | "date" => {
  if (type === "number") return "number";
  if (type === "date") return "date";

  return "text";
};

const attributeOptionLabel = (type: string, option: string) => {
  if (type !== "boolean") return option;

  return option === "true" ? "Yes" : "No";
};

/**
 * Device details collected before enrollment.
 *
 * Apple and Windows do not identify a device until its first MDM check-in, so
 * the serial is the link: answers are stored against it and claimed by the
 * device when it appears. Questions are validated by the API exactly as the
 * dashboard validates device values.
 */
export function EnrollmentDetails(props: {
  id: string | undefined;
  code: string;
  enrollment: Extract<EnrollmentResponse, { authenticated: true }>;
  onSaved: () => void;
}) {
  const questions = () => props.enrollment.questions ?? [];
  const [serial, setSerial] = createSignal("");
  const [name, setName] = createSignal("");
  const [assetTag, setAssetTag] = createSignal("");
  const [answers, setAnswers] = createSignal<Record<string, string>>({});
  const [serialError, setSerialError] = createSignal<string | null>(null);
  const [questionErrors, setQuestionErrors] = createSignal<Record<string, string>>({});
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  let serialInput: HTMLInputElement | undefined;
  const questionInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

  const setAnswer = (key: string, value: string) => {
    setAnswers({ ...answers(), [key]: value });
    setQuestionErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];

      return next;
    });
  };

  const questionDescription = (key: string) => {
    const message = questionErrors()[key];

    return message ? `enrollment-question-${key}-error` : undefined;
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();

    if (!props.id) {
      setError("This enrollment link is invalid.");

      return;
    }

    let firstInvalid: HTMLInputElement | HTMLSelectElement | undefined;

    if (!serial().trim()) {
      setSerialError("Enter this device's serial number.");
      firstInvalid = serialInput;
    } else {
      setSerialError(null);
    }

    const nextQuestionErrors: Record<string, string> = {};

    for (const question of questions()) {
      const value = (answers()[question.key] ?? "").trim();

      if (question.required && !value) {
        nextQuestionErrors[question.key] = `${question.label} is required.`;
        firstInvalid ??= questionInputs.get(question.key);
      }
    }

    setQuestionErrors(nextQuestionErrors);

    if (firstInvalid) {
      firstInvalid.focus();

      return;
    }

    setSaving(true);
    setError(null);

    const result = await submitPublicEnrollmentAnswers(props.id, {
      code: props.code || undefined,
      serial: serial().trim(),
      name: name().trim() || undefined,
      assetTag: assetTag().trim() || undefined,
      answers: answers(),
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.message);

      return;
    }

    props.onSaved();
  };

  return (
    <form
      class="mx-auto max-w-xl space-y-5"
      aria-labelledby="enrollment-details-heading"
      onSubmit={(event) => void submit(event)}
    >
      <div>
        <p class="label-caps">Before you enroll</p>
        <h2 id="enrollment-details-heading" class="mt-1 text-xl font-semibold text-foreground">
          Tell us about this device
        </h2>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">
          Your administrator asks for these details first. They are applied when this device checks
          in.
        </p>
      </div>

      <div class="space-y-1.5">
        <Label for="enrollment-serial">Serial number</Label>
        <Input
          ref={serialInput}
          id="enrollment-serial"
          name="serial"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          required
          value={serial()}
          aria-invalid={serialError() ? "true" : undefined}
          aria-describedby={serialError() ? "enrollment-serial-error" : undefined}
          onInvalid={() => setSerialError("Enter this device's serial number.")}
          onInput={(event) => {
            setSerial(event.currentTarget.value);
            setSerialError(null);
          }}
        />
        <Show when={serialError()}>
          {(message) => (
            <p id="enrollment-serial-error" class="text-xs leading-5 text-destructive">
              {message()}
            </p>
          )}
        </Show>
        <p class="text-xs leading-5 text-muted-foreground">
          You can find this in Settings or on the device label.
        </p>
      </div>

      <Show when={props.enrollment.assetTag}>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="enrollment-name">
              Device name <span class="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="enrollment-name"
              name="name"
              autocomplete="off"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </div>
          <div class="space-y-1.5">
            <Label for="enrollment-asset-tag">
              Asset tag <span class="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="enrollment-asset-tag"
              name="assetTag"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              value={assetTag()}
              onInput={(event) => setAssetTag(event.currentTarget.value)}
            />
          </div>
        </div>
      </Show>

      <For each={questions()}>
        {(question) => (
          <div class="space-y-1.5">
            <Label for={`enrollment-question-${question.key}`}>
              {question.label}
              <Show when={question.required}>
                <>
                  <span class="text-destructive" aria-hidden="true">
                    *
                  </span>
                  <span class="sr-only">(required)</span>
                </>
              </Show>
            </Label>
            <Show
              when={question.type === "select" || question.type === "boolean"}
              fallback={
                <Input
                  ref={(element) => questionInputs.set(question.key, element)}
                  id={`enrollment-question-${question.key}`}
                  name={`answers[${question.key}]`}
                  type={attributeInputType(question.type)}
                  required={question.required}
                  value={answers()[question.key] ?? ""}
                  aria-invalid={questionErrors()[question.key] ? "true" : undefined}
                  aria-describedby={questionDescription(question.key)}
                  onInvalid={() =>
                    setQuestionErrors((current) => ({
                      ...current,
                      [question.key]: `${question.label} is required.`,
                    }))
                  }
                  onInput={(event) => setAnswer(question.key, event.currentTarget.value)}
                />
              }
            >
              <select
                ref={(element) => questionInputs.set(question.key, element)}
                id={`enrollment-question-${question.key}`}
                name={`answers[${question.key}]`}
                required={question.required}
                class="h-12 w-full rounded-md border border-input bg-card px-3 text-base text-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 aria-invalid:border-destructive sm:text-sm"
                value={answers()[question.key] ?? ""}
                aria-invalid={questionErrors()[question.key] ? "true" : undefined}
                aria-describedby={questionDescription(question.key)}
                onInvalid={() =>
                  setQuestionErrors((current) => ({
                    ...current,
                    [question.key]: `${question.label} is required.`,
                  }))
                }
                onChange={(event) => setAnswer(question.key, event.currentTarget.value)}
              >
                <option value="">Choose…</option>
                <For
                  each={question.type === "boolean" ? ["true", "false"] : (question.options ?? [])}
                >
                  {(option) => (
                    <option value={option}>{attributeOptionLabel(question.type, option)}</option>
                  )}
                </For>
              </select>
            </Show>
            <Show when={questionErrors()[question.key]}>
              {(message) => (
                <p
                  id={`enrollment-question-${question.key}-error`}
                  class="text-xs text-destructive"
                >
                  {message()}
                </p>
              )}
            </Show>
          </div>
        )}
      </For>

      <Show when={error()}>
        {(message) => (
          <EnrollmentNotice
            tone="danger"
            title="These details could not be saved"
            message={message()}
          />
        )}
      </Show>

      <Button type="submit" class="min-h-11 w-full" pending={saving()}>
        {saving() ? "Saving…" : "Continue to enrollment"}
      </Button>
    </form>
  );
}
