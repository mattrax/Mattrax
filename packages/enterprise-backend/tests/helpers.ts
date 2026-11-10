import { Effect } from "effect";
import { createEnterpriseSchema } from "../src/schema.js";

export const schema = createEnterpriseSchema();

type Row = Record<string, any>;
type Store = Record<string, Row[]>;

const tableSymbol = (description: string) => (value: object) =>
  Object.getOwnPropertySymbols(value).find((symbol) => symbol.description === description)!;
const nameSymbol = tableSymbol("drizzle:Name");

const tableName = (table: any) => table?.[nameSymbol(table)] as string;
const columnName = (column: any) => column?.name as string;
const columnTable = (column: any) => tableName(column?.table);

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
      const key = `${columnTable(chunk)}.${columnName(chunk)}`;
      const fallback = columnName(chunk);
      if (op.includes(" = ") && "value" in param)
        predicates.push((row) => (key in row ? row[key] : row[fallback]) === param.value);
      if (op.toLowerCase().includes(" is null"))
        predicates.push((row) => (key in row ? row[key] : row[fallback]) == null);
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

const matchesQuery = (condition: any, row: Row) => {
  const query = queryFor(condition);
  if (!query) return true;
  let index = 0;
  const regex = /"(?:(.*?)"\.)?"(.*?)"\s*(<=|>=|<|>|=|in|is null)(?:\s*\((.*?)\))?/gi;
  const comparable = (value: unknown): any => {
    if (value instanceof Date) return value.getTime();
    // Drizzle serialises `datetime` parameters as SQL strings rather than Date
    // objects, so normalise date-looking strings before relational compares.
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      const parsed = Date.parse(value.replace(" ", "T") + "Z");
      if (Number.isFinite(parsed)) return parsed;
    }
    return value;
  };
  for (const match of query.sql.matchAll(regex)) {
    const column = camel(match[2]);
    const key = match[1] ? `${match[1]}.${column}` : column;
    const actual = key in row ? row[key] : (row[column] ?? row[match[2]]);
    const operator = match[3].toLowerCase();
    if (operator === "is null") {
      if (actual != null) return false;
    } else if (operator === "in") {
      const count = match[4]?.match(/\$\d+/g)?.length ?? 0;
      const values = query.params.slice(index, index + count);
      index += count;
      if (!values.includes(actual)) return false;
    } else if (operator === "=") {
      if (actual !== query.params[index++]) return false;
    } else {
      const expected = query.params[index++];
      const left = comparable(actual) as number | string;
      const right = comparable(expected) as number | string;
      const passes =
        operator === "<"
          ? left < right
          : operator === "<="
            ? left <= right
            : operator === ">"
              ? left > right
              : left >= right;
      if (!passes) return false;
    }
  }
  return true;
};

const matchesFieldFilter = (filter: any, value: unknown): boolean => {
  if (filter && typeof filter === "object") {
    if ("isNull" in filter) return value == null;
    if ("eq" in filter) return value === filter.eq;
  }
  return value === filter;
};

const matchesObject = (condition: Record<string, any>, row: Row): boolean =>
  Object.entries(condition).every(([key, filter]) => {
    const value = key in row ? row[key] : row[camel(key)];
    return matchesFieldFilter(filter, value);
  });

const matches = (condition: any, row: Row) => {
  if (condition === undefined) return true;
  if (queryFor(condition)) return matchesQuery(condition, row);
  if (condition && typeof condition === "object" && !("queryChunks" in condition)) {
    return matchesObject(condition, row);
  }
  return collectPredicates(condition).every((predicate) => predicate(row));
};

const project = (fields: Record<string, any> | undefined, row: Row) => {
  if (!fields) return unprefix(row);
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => {
      if (field?.table) {
        const prefixed = `${columnTable(field)}.${columnName(field)}`;
        return [key, prefixed in row ? row[prefixed] : row[columnName(field)]];
      }
      if (key === "value") return [key, row.value ?? 0];
      return [key, row[key]];
    }),
  );
};

const prefix = (table: string, row: Row) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [`${table}.${key}`, value]));
const unprefix = (row: Row) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.includes(".") ? key.split(".").at(-1)! : key,
      value,
    ]),
  );

class SelectBuilder {
  private readonly store: Store;
  private readonly fields?: Record<string, any>;
  private table = "";
  private joined?: string;
  private condition: any;
  private limitCount?: number;
  private offsetCount?: number;

  constructor(store: Store, fields?: Record<string, any>) {
    this.store = store;
    this.fields = fields;
  }

  from(table: any) {
    this.table = tableName(table);
    return this;
  }

  innerJoin(table: any) {
    this.joined = tableName(table);
    return this;
  }

  where(condition: any) {
    this.condition = condition;
    return this;
  }

  orderBy() {
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  offset(count: number) {
    this.offsetCount = count;
    return this;
  }

  private execute() {
    let rows: Row[];
    if (this.fields && "value" in this.fields && Object.keys(this.fields).length === 1) {
      rows = [
        {
          value: (this.store[this.table] ?? []).filter((row) => matches(this.condition, row))
            .length,
        },
      ];
    } else if (this.joined) {
      rows = this.joinRows()
        .filter((row) => matches(this.condition, row))
        .map((row) => project(this.fields, row));
    } else {
      rows = (this.store[this.table] ?? [])
        .filter((row) => matches(this.condition, row))
        .map((row) => project(this.fields, row));
    }
    const start = this.offsetCount ?? 0;
    const sliced = start > 0 ? rows.slice(start) : rows;
    return this.limitCount === undefined ? sliced : sliced.slice(0, this.limitCount);
  }

  then(resolve: (value: Row[]) => void, reject: (reason?: unknown) => void) {
    try {
      resolve(this.execute());
    } catch (error) {
      reject(error);
    }
  }

  [Symbol.iterator]() {
    return Effect.sync(() => this.execute())[Symbol.iterator]();
  }

  /** Allow `select(...).pipe(Effect.mapError(...))`, as Drizzle's builder does. */
  pipe(...operators: Array<(value: any) => any>) {
    let value: any = Effect.sync(() => this.execute());
    for (const operator of operators) value = operator(value);
    return value;
  }

  private joinRows() {
    const left = this.store[this.table] ?? [];
    const right = this.store[this.joined!] ?? [];
    const rows: Row[] = [];
    for (const a of left) {
      for (const b of right) {
        if (this.table === "member" && this.joined === "organization" && a.organizationId === b.id)
          rows.push({ ...prefix(this.table, a), ...prefix(this.joined, b) });
        if (this.table === "member" && this.joined === "user" && a.userId === b.id)
          rows.push({ ...prefix(this.table, a), ...prefix(this.joined, b) });
      }
    }
    return rows;
  }
}

class InsertBuilder {
  private readonly store: Store;
  private readonly table: string;
  private rows: Row[] = [];

  constructor(store: Store, table: string) {
    this.store = store;
    this.table = table;
  }

  values(value: Row | Row[]) {
    this.rows = Array.isArray(value) ? value : [value];
    this.store[this.table].push(...this.rows.map((row) => ({ ...row })));
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

  onConflictDoUpdate() {
    return this;
  }

  then(resolve: (value: Row[]) => void) {
    resolve(this.rows);
  }

  [Symbol.iterator]() {
    return Effect.succeed(this.rows)[Symbol.iterator]();
  }
}

class UpdateBuilder {
  private readonly store: Store;
  private readonly table: string;
  private patch: Row = {};

  constructor(store: Store, table: string) {
    this.store = store;
    this.table = table;
  }

  set(value: Row) {
    this.patch = value;
    return this;
  }

  where(condition: any) {
    for (const row of this.store[this.table]) {
      if (matches(condition, row)) {
        for (const [key, value] of Object.entries(this.patch))
          if (value !== undefined) row[key] = value;
      }
    }
    return this;
  }

  then(resolve: (value: Row[]) => void) {
    resolve([]);
  }

  [Symbol.iterator]() {
    return Effect.succeed([])[Symbol.iterator]();
  }
}

class DeleteBuilder {
  private readonly store: Store;
  private readonly table: string;
  private removed: Row[] = [];

  constructor(store: Store, table: string) {
    this.store = store;
    this.table = table;
  }

  where(condition: any) {
    const kept: Row[] = [];
    for (const row of this.store[this.table]) {
      if (matches(condition, row)) this.removed.push(row);
      else kept.push(row);
    }
    this.store[this.table] = kept;
    return this;
  }

  returning() {
    return this;
  }

  then(resolve: (value: Row[]) => void) {
    resolve(this.removed);
  }

  [Symbol.iterator]() {
    return Effect.succeed(this.removed)[Symbol.iterator]();
  }
}

export const makeDb = (initial: Partial<Store> = {}) => {
  const store: Store = Object.fromEntries(
    Object.keys(schema).map((key) => [tableName((schema as any)[key]), []]),
  );
  for (const [key, rows] of Object.entries(initial))
    store[key] = (rows ?? []).map((row) => ({ ...row }));

  const query = Object.fromEntries(
    Object.keys(schema).map((key) => {
      const table = tableName((schema as any)[key]);
      return [
        key,
        {
          findFirst: ({ where }: { where?: any } = {}) =>
            Effect.sync(() => store[table].find((row) => matches(where, row))),
        },
      ];
    }),
  );

  return {
    store,
    query,
    insert: (table: any) => new InsertBuilder(store, tableName(table)),
    update: (table: any) => new UpdateBuilder(store, tableName(table)),
    delete: (table: any) => new DeleteBuilder(store, tableName(table)),
    select: (fields?: Record<string, any>) => new SelectBuilder(store, fields),
  };
};

export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E, any> | Promise<Effect.Effect<A, E, any>>,
) => Effect.runPromise((await effect) as Effect.Effect<A, E, never>);

export const request = (headers: Record<string, string> = {}) => ({ headers });

export const header = (response: any, name: string) =>
  response.headers?.get?.(name) ??
  response.headers?.[name.toLowerCase()] ??
  response.headers?.[name];

export const cookieFrom = (response: any) => header(response, "set-cookie")?.split(";")[0] ?? "";

export const makeStripeClient = (overrides: Record<string, any> = {}) => ({
  customers: {
    search: async () => ({ data: [] }),
    list: async function* () {},
    create: async () => ({ id: "cus_created" }),
    ...overrides.customers,
  },
  billingPortal: {
    sessions: {
      create: async ({ return_url }: { return_url: string }) => ({ url: return_url }),
      ...overrides.billingPortal?.sessions,
    },
  },
});
