import { Data } from "effect";

export class ScepError extends Data.TaggedError("ScepError")<{
  message: string;
  cause?: unknown;
}> {}
