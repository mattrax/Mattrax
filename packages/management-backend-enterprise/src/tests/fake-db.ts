import { Effect } from "effect";
import { schema } from "@mattrax/enterprise-core";

type Row = Record<string, any>;

type Store = Record<string, Row[]>;

const tableSymbol = (description: string) => (value: object) =>
  Object.getOwnPropertySymbols(value).find((symbol) => symbol.description === description)!;

const nameSymbol = tableSymbol("drizzle:Name");

export const tableName = (table: any) => table?.[nameSymbol(table)] as string;

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

    if (chunk?.table && typeof chunk.name === "string") {
      const op = chunks[index + 1]?.value?.join?.("") ?? "";
      const param = chunks[index + 2];
      const key = chunk.name as string;

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
  value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const comparable = (value: unknown): any => {
  if (value instanceof Date) return value.getTime();

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value.replace(" ", "T") + "Z");

    if (Number.isFinite(parsed)) return parsed;
  }

  return value;
};

const matchesQuery = (condition: any, row: Row) => {
  const query = queryFor(condition);

  if (!query) return true;
  let index = 0;
  const regex = /"(?:(.*?)"\.)?"(.*?)"\s*(<=|>=|<|>|=|in|is null)(?:\s*\((.*?)\))?/gi;

  for (const match of query.sql.matchAll(regex)) {
    const column = camel(match[2]!);
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
        if (actual !== expected) return false;
        continue;
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
    private readonly fields?: Record<string, any>,
  ) {}

  private table = "";

  from(table: any) {
    this.table = tableName(table);

    return this;
  }

  where(condition: any) {
    this.condition = condition;

    return this;
  }

  // The fake store has no relational join engine. Tests only assert behaviour
  // with empty related tables, so joins are a no-op here.
  innerJoin(_table: any, _condition?: any) {
    return this;
  }

  orderBy(...columns: any[]) {
    this.order = columns
      .map(
        (column) =>
          column?.queryChunks?.find((chunk: any) => chunk?.table && chunk?.name)?.name as
            | string
            | undefined,
      )
      .filter((column): column is string => Boolean(column));

    return this;
  }

  limit(count: number) {
    return Effect.succeed(this.execute().slice(0, count));
  }

  then(resolve: (value: Row[]) => void, reject: (reason?: unknown) => void) {
    try {
      resolve(this.execute());
    } catch (error) {
      reject(error);
    }
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
      const column = this.order[index]!;
      matched.sort((left, right) => {
        const a = left[column] ?? left[camel(column)];
        const b = right[column] ?? right[camel(column)];

        return a < b ? -1 : a > b ? 1 : 0;
      });
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
    this.inserted = Array.isArray(value) ? value : [value];

    for (const row of this.inserted) this.rows().push({ ...row, __table: this.table });

    return this;
  }

  ignore() {
    return this;
  }

  onConflictDoNothing() {
    return this;
  }

  onDuplicateKeyUpdate() {
    return this;
  }

  then(resolve: (value: Row[]) => void) {
    resolve(this.inserted);
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
    for (const row of this.rows()) {
      if (row.__table !== this.table) continue;

      if (!matches(condition, row)) continue;

      for (const [key, value] of Object.entries(this.patch)) {
        if (value !== undefined) row[key] = value;
      }
    }

    return Effect.succeed([]);
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
      const row = rows[index]!;

      if (row.__table === this.table && matches(condition, row)) rows.splice(index, 1);
    }

    return Effect.succeed([]);
  }

  then(resolve: (value: Row[]) => void) {
    resolve([]);
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

  return {
    store,
    insert: (table: any) => new InsertBuilder(() => ensure(tableName(table)), tableName(table)),
    update: (table: any) => new UpdateBuilder(() => ensure(tableName(table)), tableName(table)),
    delete: (table: any) => new DeleteBuilder(() => ensure(tableName(table)), tableName(table)),
    select: (fields?: Record<string, any>) =>
      new SelectBuilder(() => Object.values(store).flat(), fields),
  };
};

export const dbRows = (db: ReturnType<typeof makeDb>, table: string) =>
  (db.store[table] ?? []).map(unprefix);
