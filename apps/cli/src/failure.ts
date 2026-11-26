import { Schema } from "effect";

/** A handler-level failure that the CLI formats once, without a stack trace. */
export class CliFailure extends Schema.TaggedError<CliFailure>()("CliFailure", {
  message: Schema.String,
  /** Extra guidance printed under the error. */
  hint: Schema.optional(Schema.String),
  /** Override the process exit code (defaults to 1). */
  exitCode: Schema.optional(Schema.Number),
  /** The handler already rendered the failure; do not print it twice. */
  silent: Schema.optional(Schema.Boolean),
}) {}
