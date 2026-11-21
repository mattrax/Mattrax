import { Effect, Schema } from "effect";
import { schema } from "@mattrax/enterprise-core";

type RowValue =
  | null
  | undefined
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | ArrayBuffer
  | JsonWebKey
  | ReadonlyArray<RowValue>
  | Row;

export type Row = { [key: string]: RowValue };

export type Store = { [key: string]: Row[] };

/** Read a row value that the test seeded as a string. */
export const stringValue = (value: RowValue): string =>
  Schema.decodeUnknownSync(Schema.String)(value);

/** Read a row value that the test seeded as JSON. */
export const jsonValue = (value: RowValue): Schema.Json =>
  Schema.decodeUnknownSync(Schema.Json)(value);

/** Read a row value that the test seeded as a date. */
export const dateValue = (value: RowValue): Date =>
  Schema.decodeUnknownSync(Schema.instanceOf(Date))(value);

type QueryColumn = { readonly name?: string };

type Fields = { readonly [key: string]: QueryColumn };

// Test tables are arbitrary Drizzle mocks; the helper only reads their symbols.
// oxlint-disable-next-line quality/no-object-parameters -- test helper receives arbitrary table mocks.
const tableSymbol = (description: string) => (value: object) =>
  Object.getOwnPropertySymbols(value).find((symbol) => symbol.description === description)!;

const nameSymbol = tableSymbol("drizzle:Name");

export const tableName = (table: any): string => table?.[nameSymbol(table)];

const flattenChunks = (value: any): any[] => {
  if (!value?.queryChunks) return [value];

  return value.queryChunks.flatMap((chunk: any) => flattenChunks(chunk));
};

const collectPredicates = (condition: any): Array<(row: Row) => boolean> => {
  if (!condition?.queryChunks) return [];
  const chunks = flattenChunks(condition);
  const predicates: Array<(row: Row) => boolean> = [];

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];

    if (chunk?.table && Schema.is(Schema.String)(chunk.name)) {
      const op = chunks[index + 1]?.value?.join?.("") ?? "";
      const param = chunks[index + 2];
      const key = chunk.name;

      if (op.includes(" = ") && "value" in param)
        predicates.push((row) => (row[key] ?? row[camel(key)]) === param.value);

      if (op.toLowerCase().includes(" is null"))
        predicates.push((row) => (row[key] ?? row[camel(key)]) == null);
    }
  }

  return predicates;
};

const queryFor = (condition: any) =>
  condition?.toQuery?.({
    casing: { getColumnCasing: (column: any) => column.name },
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => `$${index + 1}`,
    escapeString: (value: string) => `'${value}'`,
  });

const camel = (value: string) =>
  value.replaceAll(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/**
 * Primary keys for the tables whose upserts these tests depend on. Values are
 * Drizzle property names (the fake store keeps rows in that shape).
 */
const PRIMARY_KEYS = new Map<string, ReadonlyArray<string>>([
  ["device_apple_user", ["deviceId", "userId"]],
  ["device_apple", ["deviceId"]],
  ["device", ["id"]],
  ["scep_issued_certificate", ["serial"]],
]);

const comparable = (value: RowValue): number | string => {
  if (value instanceof Date) return value.getTime();

  if (Schema.is(Schema.String)(value) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value.replace(" ", "T") + "Z");

    if (Number.isFinite(parsed)) return parsed;
  }

  if (Schema.is(Schema.Number)(value)) return value;

  if (Schema.is(Schema.Boolean)(value)) return String(value);

  return "";
};

const matchesQuery = (condition: any, row: Row) => {
  const query = queryFor(condition);

  if (!query) return true;
  let index = 0;
  const regex = /"(?:(.*?)"\.)?"(.*?)"\s*(<=|>=|<|>|=|in|is null)(?:\s*\((.*?)\))?/gi;

  for (const match of query.sql.matchAll(regex)) {
    const column = camel(match[2]);
    const key = match[1] ? `${match[1]}.${column}` : column;
    const actual = key in row ? row[key] : (row[column] ?? row[match[2]!]);
    const operator = match[3]!.toLowerCase();

    if (operator === "is null") {
      if (actual != null) return false;
    } else if (operator === "in") {
      const count = match[4]?.match(/\$\d+/g)?.length ?? 0;
      const values = query.params.slice(index, index + count);
      index += count;

      if (!values.includes(actual)) return false;
    } else {
      const expected = query.params[index++];

      if (operator === "=") {
        if (actual === expected) continue;

        // Drizzle serialises datetime parameters, so a bucket lookup compares
        // the stored Date with the formatted string for the same instant.
        const dateLike = (value: RowValue) =>
          value instanceof Date ||
          (Schema.is(Schema.String)(value) && /^\d{4}-\d{2}-\d{2}/.test(value));

        if (dateLike(actual) && dateLike(expected) && comparable(actual) === comparable(expected))
          continue;

        return false;
      }

      const left = comparable(actual);
      const right = comparable(expected);

      if (operator === "<" && !(left < right)) return false;

      if (operator === "<=" && !(left <= right)) return false;

      if (operator === ">" && !(left > right)) return false;

      if (operator === ">=" && !(left >= right)) return false;
    }
  }

  return true;
};

const matches = (condition: any, row: Row) => {
  if (condition === undefined) return true;

  if (queryFor(condition)) return matchesQuery(condition, row);

  return collectPredicates(condition).every((predicate) => predicate(row));
};

class SelectBuilder {
  constructor(
    private readonly rows: () => Row[],
    private readonly fields?: Fields,
  ) {}

  private table = "";
  private joined?: string;

  from(table: any) {
    this.table = tableName(table);

    return this;
  }

  where(condition: any) {
    this.condition = condition;

    return this;
  }

  /**
   * Minimal join support for the two shapes the backend reads with a Drizzle
   * join: `configuration → policy` and `device_apple → device`. The joined row
   * is nested under its table name, matching Drizzle's unprojected result.
   * When the joined table is empty the historical no-op is kept so unrelated
   * tests are unaffected.
   */
  innerJoin(table: any, _condition?: any) {
    this.joined = tableName(table);

    return this;
  }

  orderBy(...columns: any[]) {
    this.order = columns
      .map((column) => column?.queryChunks?.find((chunk: any) => chunk?.table && chunk?.name)?.name)
      .filter((column): column is string => Boolean(column));

    return this;
  }

  limit(count: number) {
    return Effect.succeed(this.execute().slice(0, count));
  }

  [Symbol.iterator]() {
    return Effect.succeed(this.execute())[Symbol.iterator]();
  }

  private condition: any = undefined;
  private order: string[] = [];

  private execute() {
    const rows = this.rows().filter((row) => row.__table === this.table);
    const matched = rows.filter((row) => matches(this.condition, row));

    for (let index = this.order.length - 1; index >= 0; index--) {
      const column = this.order[index];
      matched.sort((left, right) => {
        const a = comparable(left[column] ?? left[camel(column)] ?? null);
        const b = comparable(right[column] ?? right[camel(column)] ?? null);

        return a < b ? -1 : a > b ? 1 : 0;
      });
    }

    if (this.joined) {
      const joinedRows = this.rows().filter((row) => row.__table === this.joined);

      if (joinedRows.length > 0) {
        const localKey = `${camel(this.joined)}Id`;

        return matched.flatMap((left) =>
          joinedRows
            .filter((right) => right.id === (left[localKey] ?? left[camel(localKey)]))
            .map((right) => ({ [this.table]: unprefix(left), [this.joined!]: unprefix(right) })),
        );
      }
    }

    const fields = this.fields;

    if (!fields) return matched.map(unprefix);

    return matched.map((row) =>
      Object.fromEntries(
        Object.entries(fields).map(([key, field]) => {
          const column = field?.name ?? key;
          const value = row[column] ?? row[camel(column)];

          return [key, value];
        }),
      ),
    );
  }
}

const unprefix = (row: Row) =>
  Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== "__table")
      .map(([key, value]) => [key, value]),
  );

class InsertBuilder {
  private inserted: Row[] = [];

  constructor(
    private readonly rows: () => Row[],
    private readonly table: string,
  ) {}

  values(value: Row | Row[]) {
    this.inserted = (Array.isArray(value) ? value : [value]).map((row) => ({
      ...row,
      __table: this.table,
    }));

    for (const row of this.inserted) this.rows().push(row);

    return this;
  }

  ignore() {
    return this;
  }

  onConflictDoNothing() {
    return this;
  }

  /**
   * MySQL's upsert semantics for the tables these tests exercise. Without this
   * the fake would keep both rows, so a second TokenUpdate would look like a
   * duplicate channel instead of an update.
   */
  onDuplicateKeyUpdate(config?: { set?: Row }) {
    const primaryKey = PRIMARY_KEYS.get(this.table);

    if (!primaryKey || !config?.set) return this;

    const rows = this.rows();

    for (const inserted of this.inserted) {
      const existing = rows.find(
        (row) =>
          row.__table === this.table &&
          row !== inserted &&
          primaryKey.every((column) => row[column] === inserted[column]),
      );

      if (!existing) continue;

      for (const [key, value] of Object.entries(config.set))
        if (value !== undefined) existing[key] = value;

      const insertedIndex = rows.indexOf(inserted);

      if (insertedIndex !== -1) rows.splice(insertedIndex, 1);
    }

    return this;
  }

  [Symbol.iterator]() {
    return Effect.succeed(this.inserted)[Symbol.iterator]();
  }
}

class UpdateBuilder {
  private patch: Row = {};

  constructor(
    private readonly rows: () => Row[],
    private readonly table: string,
  ) {}

  set(value: Row) {
    this.patch = value;

    return this;
  }

  where(condition: any) {
    let affectedRows = 0;

    for (const row of this.rows()) {
      if (row.__table !== this.table) continue;

      if (!matches(condition, row)) continue;

      affectedRows++;

      for (const [key, value] of Object.entries(this.patch)) {
        if (value !== undefined) row[key] = value;
      }
    }

    return Effect.succeed({ affectedRows });
  }
}

class DeleteBuilder {
  constructor(
    private readonly rows: () => Row[],
    private readonly table: string,
  ) {}

  where(condition: any) {
    const rows = this.rows();

    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index];

      if (row.__table === this.table && matches(condition, row)) rows.splice(index, 1);
    }

    return Effect.succeed([]);
  }

  [Symbol.iterator]() {
    return Effect.succeed([])[Symbol.iterator]();
  }
}

export const makeDb = (initial: Partial<Store> = {}) => {
  const store: Store = {};
  const ensure = (table: string) => (store[table] ??= []);

  for (const [table, rows] of Object.entries(initial)) {
    store[table] = (rows ?? []).map((row) => ({ ...row, __table: table }));
  }

  ensure(tableName(schema.organization));
  ensure(tableName(schema.device));
  ensure(tableName(schema.scepCa));
  ensure(tableName(schema.scepChallenge));

  const db = {
    store,
    insert: (table: any) => new InsertBuilder(() => ensure(tableName(table)), tableName(table)),
    update: (table: any) => new UpdateBuilder(() => ensure(tableName(table)), tableName(table)),
    delete: (table: any) => new DeleteBuilder(() => ensure(tableName(table)), tableName(table)),
    select: (fields?: Fields) => new SelectBuilder(() => Object.values(store).flat(), fields),
    // The production Db exposes a transaction; the in-memory fake applies the
    // work directly so transactional code paths can be exercised.
    transaction: <Result>(work: (tx: any) => Result): Result => work(db),
  };

  return db;
};

export const dbRows = (db: ReturnType<typeof makeDb>, table: string) =>
  (db.store[table] ?? []).map(unprefix);
