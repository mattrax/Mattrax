import { Context, Effect, Layer } from "effect";

export interface CliOutputContract {
  readonly out: (text: string) => Effect.Effect<void>;
  readonly err: (text: string) => Effect.Effect<void>;
}

/**
 * Terminal output is a service so command tests can assert what a command
 * prints instead of patching `process.stdout`.
 */
export class CliOutput extends Context.Service<CliOutput, CliOutputContract>()(
  "@mattrax/cli/CliOutput",
) {}

const write = (stream: NodeJS.WriteStream, text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    stream.write(text.endsWith("\n") ? text : `${text}\n`);
  });

export const processOutputLayer = Layer.succeed(
  CliOutput,
  CliOutput.of({
    out: (text) => write(process.stdout, text),
    err: (text) => write(process.stderr, text),
  }),
);

export const line = (text: string): Effect.Effect<void, never, CliOutput> =>
  Effect.flatMap(CliOutput, (output) => output.out(text));

export const errorLine = (text: string): Effect.Effect<void, never, CliOutput> =>
  Effect.flatMap(CliOutput, (output) => output.err(text));

export const formatJson = <A>(value: A): string => JSON.stringify(value, null, 2);

const cell = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return "-";

  return String(value);
};

/**
 * Render a left-aligned text table. Padding is based on code units, which is
 * enough for the ASCII device and policy identifiers the CLI displays and
 * keeps the output stable in narrow terminals and CI logs.
 */
export const formatTable = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string => {
  const body = rows.map((row) => row.map(cell));

  const widths = headers.map((header, index) =>
    body.reduce((width, row) => Math.max(width, row[index]?.length ?? 0), header.length),
  );

  const formatRow = (row: ReadonlyArray<string>) =>
    row
      .map((value, index) => value.padEnd(widths[index] ?? value.length))
      .join("  ")
      .trimEnd();

  return [formatRow(headers), ...body.map(formatRow)].join("\n");
};

export interface KeyValue {
  readonly key: string;
  readonly value: string | number | boolean | null | undefined;
}

export const formatKeyValues = (entries: ReadonlyArray<KeyValue>): string => {
  const width = entries.reduce((max, entry) => Math.max(max, entry.key.length), 0);

  return entries.map((entry) => `${entry.key.padEnd(width)}  ${cell(entry.value)}`).join("\n");
};
