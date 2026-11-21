import { Schema } from "effect";

const isString = Schema.is(Schema.String);

const isRecord = (value: Schema.Json | undefined): value is Record<string, Schema.Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Remove emails and long opaque tokens from text a person did not type as a message. */
export const redactPostHogText = (value: string): string =>
  value
    .replaceAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replaceAll(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]");

const withoutQuery = (value: Schema.Json): Schema.Json => {
  if (!isString(value)) return value;

  try {
    const url = new URL(value, globalThis.location?.href);
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return value;
  }
};

/**
 * Autocapture can attach the text of the clicked element and its ancestors.
 * Device names, serials, emails and tokens can all appear there, so redact the
 * text-bearing attributes before the event leaves the browser.
 */
const ELEMENT_TEXT_KEYS = [
  "$el_text",
  "attr__aria-label",
  "attr__title",
  "attr__alt",
  "attr__placeholder",
  "attr__value",
  "attr__name",
] as const;

const sanitizeElement = (value: Schema.Json): Schema.Json => {
  if (isString(value)) return redactPostHogText(value);

  if (Array.isArray(value)) return value.map(sanitizeElement);

  if (!isRecord(value)) return value;

  // SAFETY: the predicate only proves the shape, not mutability; capture
  // properties are plain objects assembled by posthog-js.
  // SAFETY: posthog-js builds these captures as plain mutable objects; the
  // readonly Schema.Json index signature is the decoder shape, not the
  // object shape.
  const element = value as { [key: string]: Schema.Json };

  for (const key of ELEMENT_TEXT_KEYS) {
    const current = element[key];

    if (isString(current)) element[key] = redactPostHogText(current);
  }

  return value;
};

type SanitizableCapture = { properties?: Record<string, Schema.Json> };

/**
 * Privacy filter for every browser capture.
 *
 * Query strings and fragments are removed from page URLs, autocaptured element
 * text is redacted, and the exception payloads the error boundary sends are
 * stripped of emails and tokens. Person properties (`$set.email`) are left
 * alone: those are the account's own details, not incidental page text.
 */
export const sanitizePostHogCapture = <T>(
  capture: T,
  superProperties: Record<string, Schema.Json> = {},
): T => {
  // SAFETY: posthog-js capture payloads are plain objects; the cast only
  // restores the mutable property bag that its public type narrows.
  const target = capture as SanitizableCapture;
  const properties = (target.properties ??= {});

  for (const key of ["$current_url", "$referrer"]) {
    if (key in properties) properties[key] = withoutQuery(properties[key]);
  }

  if (isString(properties.$el_text)) properties.$el_text = redactPostHogText(properties.$el_text);

  if (Array.isArray(properties.$elements))
    properties.$elements = properties.$elements.map(sanitizeElement);

  const exceptionValues = properties.$exception_values;

  if (Array.isArray(exceptionValues))
    properties.$exception_values = exceptionValues.map((item) =>
      isString(item) ? redactPostHogText(item) : item,
    );

  const exceptions = properties.$exception_list;

  if (Array.isArray(exceptions))
    properties.$exception_list = exceptions.map((item) => {
      if (item === null || !isRecord(item) || !isString(item.value)) return item;

      return { ...item, value: redactPostHogText(item.value) };
    });

  for (const [key, value] of Object.entries(superProperties))
    if (value !== undefined && properties[key] === undefined) properties[key] = value;

  return capture;
};
