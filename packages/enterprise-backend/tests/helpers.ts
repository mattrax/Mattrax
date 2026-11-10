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

/** Split on a connector that appears outside parentheses/quotes. */
const splitTopLevel = (sql: string, connector: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]!;
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "(") depth++;
    else if (!quoted && character === ")") depth--;
    else if (!quoted && depth === 0 && sql.startsWith(connector, index)) {
      parts.push(sql.slice(start, index));
      start = index + connector.length;
      index += connector.length - 1;
    }
  }
  parts.push(sql.slice(start));
  return parts;
};

const stripOuterParens = (sql: string) => {
  let value = sql.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    let depth = 0;
    let closesAtEnd = false;
    for (let index = 0; index < value.length; index++) {
      const character = value[index]!;
      if (character === "(") depth++;
      else if (character === ")") {
        depth--;
        if (depth === 0) {
          closesAtEnd = index === value.length - 1;
          break;
        }
      }
    }
    if (!closesAtEnd) break;
    value = value.slice(1, -1).trim();
  }
  return value;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const likeRegex = (pattern: string) => {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "\\" && index + 1 < pattern.length) {
      source += escapeRegex(pattern[++index]!);
    } else if (character === "%") source += ".*";
    else if (character === "_") source += ".";
    else source += escapeRegex(character);
  }
  return new RegExp(`${source}$`, "i");
};

const rowValue = (row: Row, table: string | undefined, column: string) => {
  const name = camel(column);
  const key = table ? `${table}.${name}` : name;
  return key in row ? row[key] : (row[column] ?? row[name]);
};

const matchesLeaf = (sql: string, params: any[], row: Row): boolean => {
  const isNull = sql.match(/^(?:"([^"]+)"\.)?"([^"]+)"\s+is\s+null$/i);
  if (isNull) return rowValue(row, isNull[1], isNull[2]!) == null;

  const inList = sql.match(/^(?:"([^"]+)"\.)?"([^"]+)"\s+in\s+\(([^)]*)\)$/i);
  if (inList) {
    const values = [...inList[3]!.matchAll(/\$(\d+)/g)].map(
      (match) => params[Number(match[1]) - 1],
    );
    return values.includes(rowValue(row, inList[1], inList[2]!));
  }

  const comparison = sql.match(/^(?:"([^"]+)"\.)?"([^"]+)"\s*(<=|>=|<|>|=|like)\s*\$(\d+)$/i);
  // Unknown leaf (e.g. a generated literal): do not exclude the row.
  if (!comparison) return true;
  const actual = rowValue(row, comparison[1], comparison[2]!);
  const operator = comparison[3]!.toLowerCase();
  const expected = params[Number(comparison[4]) - 1];
  if (operator === "=") return actual === expected;
  if (operator === "like")
    return actual != null && likeRegex(String(expected)).test(String(actual));
  const left = comparable(actual) as number | string;
  const right = comparable(expected) as number | string;
  if (operator === "<") return left < right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  return left >= right;
};

const matchesSql = (sql: string, params: any[], row: Row): boolean => {
  const text = stripOuterParens(sql);
  if (!text) return true;
  const orParts = splitTopLevel(text, " or ");
  if (orParts.length > 1) return orParts.some((part) => matchesSql(part, params, row));
  const andParts = splitTopLevel(text, " and ");
  if (andParts.length > 1) return andParts.every((part) => matchesSql(part, params, row));
  return matchesLeaf(text, params, row);
};

const matchesQuery = (condition: any, row: Row) => {
  const query = queryFor(condition);
  if (!query) return true;
  return matchesSql(query.sql, query.params, row);
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
  private order: Array<{ table: string; name: string; descending: boolean }> = [];

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

  orderBy(...columns: any[]) {
    this.order = columns.flatMap((column) => {
      const chunks = flattenChunks(column);
      const found = chunks.find((chunk) => chunk?.table && typeof chunk.name === "string") as
        | { table: any; name: string }
        | undefined;
      if (!found) return [];
      const descending = chunks.some(
        (chunk) => typeof chunk?.value === "string" && chunk.value.toLowerCase().trim() === "desc",
      );
      return [{ table: columnTable(found), name: found.name, descending }];
    });
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
    if (this.order.length > 0)
      rows = [...rows].sort((left, right) => {
        for (const key of this.order) {
          const a = rowValue(left, key.table, key.name);
          const b = rowValue(right, key.table, key.name);
          const aValue = a instanceof Date ? a.getTime() : a;
          const bValue = b instanceof Date ? b.getTime() : b;
          if (aValue === bValue) continue;
          const compared = (aValue ?? 0) < (bValue ?? 0) ? -1 : 1;
          return key.descending ? -compared : compared;
        }
        return 0;
      });
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
          findMany: ({ where }: { where?: any } = {}) =>
            Effect.sync(() => store[table].filter((row) => matches(where, row))),
        },
      ];
    }),
  );

  const db: any = {
    store,
    query,
    insert: (table: any) => new InsertBuilder(store, tableName(table)),
    update: (table: any) => new UpdateBuilder(store, tableName(table)),
    delete: (table: any) => new DeleteBuilder(store, tableName(table)),
    select: (fields?: Record<string, any>) => new SelectBuilder(store, fields),
    // The production Db exposes a transaction; the in-memory fake applies the
    // work directly so page-per-transaction code paths can be exercised.
    transaction: (work: (tx: any) => unknown) => work(db),
  };
  return db;
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
