import { Option, Schema } from "effect";
import { errorPresentation, raisedFailure } from "~/lib/errors";

/**
 * Turn an HTTP failure into a friendly message. Tagged API failures are
 * normalised by `errorPresentation`; anything else keeps the status fallback
 * instead of surfacing a raw response body.
 */
export const responseFailure = async (response: Response, fallback: string) => {
  const text = await response.text().catch(() => "");
  let body: Schema.Json | undefined = text;

  try {
    body = text
      ? Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text)))
      : undefined;
  } catch {
    // Plain-text error bodies are replaced by the status fallback below.
  }

  const presentation = errorPresentation(raisedFailure(body), fallback);

  return new Error(presentation.tag ? presentation.message : fallback);
};
