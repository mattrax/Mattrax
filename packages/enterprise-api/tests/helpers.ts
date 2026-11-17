import { Effect, Schema } from "effect";
import type { HttpServerRequest } from "effect/http";
import { createEnterpriseSchema } from "@mattrax/enterprise-backend";

export const schema = createEnterpriseSchema();

/**
 * A value the fake store holds for one column: the scalars, dates and nested
 * rows the production schema writes.
 */
type RowValue =
  | string
  | number
  | boolean
  | bigint
  | Date
  | null
  | undefined
  | RowValue[]
  | ReadonlyArray<RowValue>
  | Row;

type Row = { [column: string]: RowValue };

type Store = Record<string, Row[]>;

const tableSymbol = (description: string) => (value: Row) =>
  Object.getOwnPropertySymbols(value).find((symbol) => symbol.description === description)!;

const nameSymbol = tableSymbol("drizzle:Name");

const tableName = (table: any): string => table?.[nameSymbol(table)];

const columnName = (column: any): string => column?.name;

const columnTable = (column: any) => tableName(column?.table);

/** A drizzle column chunk embedded in a compiled condition. */
type ColumnChunk = { readonly table: any; readonly name: string };

const isColumnChunk = (chunk: any): chunk is ColumnChunk =>
  chunk?.table != null && Schema.is(Schema.String)(chunk.name);

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

    if (isColumnChunk(chunk)) {
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

/** Values the fake orders and compares: everything normalises to one of these. */
type Comparable = number | string;

const comparable = (value: RowValue): Comparable => {
  if (value instanceof Date) return value.getTime();

  // Drizzle serialises `datetime` parameters as SQL strings rather than Date
  // objects, so normalise date-looking strings before relational compares.
  if (Schema.is(Schema.String)(value) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value.replace(" ", "T") + "Z");

    if (Number.isFinite(parsed)) return parsed;
  }

  if (value == null) return "";

  return Schema.is(Schema.Number)(value) ? value : String(value);
};

/** Order two normalised values, treating mixed types as text. */
const compareComparable = (left: Comparable, right: Comparable): number => {
  if (left === right) return 0;

  if (Schema.is(Schema.Number)(left) && Schema.is(Schema.Number)(right))
    return left < right ? -1 : 1;

  return String(left) < String(right) ? -1 : 1;
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

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Render a UTC date the way MySQL's `date_format` does for the tokens the
 * device search uses. The fake runs without a database, so SQL that formats a
 * column (rather than comparing it) needs a local implementation.
 */
const mysqlDateFormat = (date: Date, format: string) => {
  const pad = (value: number) => String(value).padStart(2, "0");

  const replacements = new Map<string, string>([
    ["%Y", String(date.getUTCFullYear())],
    ["%y", String(date.getUTCFullYear()).slice(-2)],
    ["%m", pad(date.getUTCMonth() + 1)],
    ["%c", String(date.getUTCMonth() + 1)],
    ["%d", pad(date.getUTCDate())],
    ["%e", String(date.getUTCDate())],
    ["%H", pad(date.getUTCHours())],
    ["%i", pad(date.getUTCMinutes())],
    ["%s", pad(date.getUTCSeconds())],
    ["%b", MONTHS_SHORT[date.getUTCMonth()]!],
    ["%M", MONTHS_LONG[date.getUTCMonth()]!],
  ]);

  return format.replaceAll(/%[YymcdeHisbM]/g, (token) => replacements.get(token) ?? token);
};

const rowValue = (row: Row, table: string | undefined, column: string) => {
  const name = camel(column);
  const key = table ? `${table}.${name}` : name;

  return key in row ? row[key] : (row[column] ?? row[name]);
};

const matchesLeaf = (sql: string, params: any[], row: Row): boolean => {
  const isNull = sql.match(/^(?:"([^"]+)"\.)?"([^"]+)"\s+is\s+null$/i);

  if (isNull) return rowValue(row, isNull[1], isNull[2]!) == null;

  // `date_format("device"."last_seen_at", '%Y-%m-%d') like $1`.
  const dateFormatLike = sql.match(
    /^date_format\("([^"]+)"\."([^"]+)",\s*'([^']*)'\)\s+like\s+\$(\d+)$/i,
  );

  if (dateFormatLike) {
    const value = rowValue(row, dateFormatLike[1], dateFormatLike[2]!);

    if (value == null) return false;

    const date =
      value instanceof Date ? value : Schema.is(Schema.String)(value) ? new Date(value) : null;

    if (!date || Number.isNaN(date.getTime())) return false;

    return likeRegex(String(params[Number(dateFormatLike[4]) - 1])).test(
      mysqlDateFormat(date, dateFormatLike[3]!),
    );
  }

  // A subquery bound as a single parameter (`in $1`, `not in $1`). The caller
  // resolves the parameter to the ids the subquery selects.
  const inParam = sql.match(/^(?:"([^"]+)"\.)?"([^"]+)"\s+(not\s+)?in\s+\$(\d+)$/i);

  if (inParam) {
    const list = params[Number(inParam[4]) - 1];
    const values = Array.isArray(list) ? list.map((entry) => comparable(entry)) : [];
    const found = values.includes(comparable(rowValue(row, inParam[1], inParam[2]!)));

    return inParam[3] ? !found : found;
  }

  const inList = sql.match(/^(?:"([^"]+)"\.)?"([^"]+)"\s+in\s+\(([^)]*)\)$/i);

  if (inList) {
    const values = [...inList[3]!.matchAll(/\$(\d+)/g)].map(
      (match) => params[Number(match[1]) - 1],
    );

    return values.includes(rowValue(row, inList[1], inList[2]!));
  }

  // Column-to-column comparison, which is how drizzle renders a join's ON
  // clause (`"organization"."id" = "member"."organization_id"`).
  const columnComparison = sql.match(
    /^(?:"([^"]+)"\.)?"([^"]+)"\s*(=|<>|!=)\s*(?:"([^"]+)"\.)?"([^"]+)"$/i,
  );

  if (columnComparison) {
    const left = rowValue(row, columnComparison[1], columnComparison[2]!);
    const right = rowValue(row, columnComparison[4], columnComparison[5]!);

    // SQL comparisons against NULL are never true.
    if (left == null || right == null) return false;

    const equal = compareComparable(comparable(left), comparable(right)) === 0;

    return columnComparison[3] === "=" ? equal : !equal;
  }

  const comparison = sql.match(/^(?:"([^"]+)"\.)?"([^"]+)"\s*(<=|>=|<|>|=|like)\s*\$(\d+)$/i);

  // Unknown leaf (e.g. a generated literal): do not exclude the row.
  if (!comparison) return true;
  const actual = rowValue(row, comparison[1], comparison[2]!);
  const operator = comparison[3]!.toLowerCase();
  const expected = params[Number(comparison[4]) - 1];

  if (operator === "=") {
    if (actual === expected) return true;

    // Drizzle serialises datetime parameters, so a conditional update that
    // compares a stored Date with the same instant needs semantic equality.
    if (actual instanceof Date || expected instanceof Date)
      return compareComparable(comparable(actual), comparable(expected)) === 0;

    return false;
  }

  if (operator === "like")
    return actual != null && likeRegex(String(expected)).test(String(actual));
  const order = compareComparable(comparable(actual), comparable(expected));

  if (operator === "<") return order < 0;

  if (operator === "<=") return order <= 0;

  if (operator === ">") return order > 0;

  return order >= 0;
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

/**
 * Params that hold a select builder (an `inArray`/`notInArray` subquery) are
 * evaluated to the ids it selects so the outer SQL can stay a string match.
 */
type SelectExecutor = { execute(): Row[] };

const isSelectExecutor = (value: unknown): value is SelectExecutor =>
  value instanceof SelectBuilder;

const resolveParams = (params: any[]) =>
  params.map((param) =>
    isSelectExecutor(param) ? param.execute().map((selected) => Object.values(selected)[0]) : param,
  );

const matchesQuery = (condition: any, row: Row) => {
  const query = queryFor(condition);

  if (!query) return true;

  return matchesSql(query.sql, resolveParams(query.params), row);
};

/**
 * The two filter shapes the fake understands. `Schema.Any` keeps arbitrary
 * column values (dates included) comparable, matching the production operators.
 */
const FieldFilter = Schema.Struct({
  isNull: Schema.optional(Schema.Any),
  eq: Schema.optional(Schema.Any),
});

const matchesFieldFilter = (filter: RowValue, value: RowValue): boolean => {
  if (Schema.is(FieldFilter)(filter)) {
    if ("isNull" in filter) return value == null;

    if ("eq" in filter) return value === filter.eq;
  }

  return value === filter;
};

const matchesObject = (condition: Row, row: Row): boolean =>
  Object.entries(condition).every(([key, filter]) => {
    const value = key in row ? row[key] : row[camel(key)];

    return matchesFieldFilter(filter, value);
  });

/** Any plain object: an untyped condition is read as a column-to-filter map. */
const isConditionObject = Schema.is(Schema.Record(Schema.String, Schema.Any));

const matches = (condition: any, row: Row) => {
  if (condition === undefined) return true;

  if (queryFor(condition)) return matchesQuery(condition, row);

  if (isConditionObject(condition) && !("queryChunks" in condition)) {
    return matchesObject(condition, row);
  }

  return collectPredicates(condition).every((predicate) => predicate(row));
};

const project = (fields: any, row: Row) => {
  if (!fields) return unprefix(row);

  return Object.fromEntries(
    Object.keys(fields).map((key) => {
      const field = fields[key];

      // A whole table selected as a named field (`{ member: schema.member }`)
      // is projected as an unprefixed row so callers get a nested object.
      const nested = tableName(field);

      if (nested) {
        const prefix = `${nested}.`;

        return [
          key,
          Object.fromEntries(
            Object.entries(row)
              .filter(([name]) => name.startsWith(prefix))
              .map(([name, value]) => [name.slice(prefix.length), value]),
          ),
        ];
      }

      if (field?.table) {
        const prefixed = `${columnTable(field)}.${columnName(field)}`;
        const column = columnName(field);
        const camelPrefixed = `${columnTable(field)}.${camel(column)}`;

        const candidates = [prefixed, camelPrefixed, column, camel(column)];
        const match = candidates.find((candidate) => candidate in row);

        return [key, match === undefined ? undefined : row[match]];
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
  private readonly fields?: any;
  private table = "";
  private joined?: string;
  private joinCondition?: any;
  private condition: any;
  private limitCount?: number;
  private offsetCount?: number;
  private order: Array<{ table: string; name: string; descending: boolean }> = [];

  constructor(store: Store, fields?: any) {
    this.store = store;
    this.fields = fields;
  }

  from(table: any) {
    this.table = tableName(table);

    return this;
  }

  innerJoin(table: any, on?: any) {
    this.joined = tableName(table);
    this.joinCondition = on;

    return this;
  }

  where(condition: any) {
    this.condition = condition;

    return this;
  }

  orderBy(...columns: any[]) {
    this.order = columns.flatMap((column) => {
      const chunks = flattenChunks(column);

      const found = chunks.find(isColumnChunk);

      if (!found) return [];

      const descending = chunks.some(
        (chunk) =>
          Schema.is(Schema.String)(chunk?.value) && chunk.value.toLowerCase().trim() === "desc",
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
          const compared = compareComparable(
            comparable(rowValue(left, key.table, key.name)),
            comparable(rowValue(right, key.table, key.name)),
          );

          if (compared === 0) continue;

          return key.descending ? -compared : compared;
        }

        return 0;
      });
    const start = this.offsetCount ?? 0;
    const sliced = start > 0 ? rows.slice(start) : rows;

    return this.limitCount === undefined ? sliced : sliced.slice(0, this.limitCount);
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

  /** Nested-loop join over the single joined table, using the ON condition. */
  private joinRows() {
    const left = this.store[this.table] ?? [];
    const right = this.store[this.joined!] ?? [];
    const rows: Row[] = [];

    for (const a of left) {
      for (const b of right) {
        const combined = { ...prefix(this.table, a), ...prefix(this.joined!, b) };

        if (!this.joinCondition || matches(this.joinCondition, combined)) rows.push(combined);
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
    let affectedRows = 0;

    for (const row of this.store[this.table]) {
      if (matches(condition, row)) {
        affectedRows++;

        for (const [key, value] of Object.entries(this.patch))
          if (value !== undefined) row[key] = value;
      }
    }

    // Drizzle's MySQL update resolves to a result with `affectedRows`, which
    // conditional claims rely on for compare-and-set semantics.
    return Effect.succeed({ affectedRows });
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

  [Symbol.iterator]() {
    return Effect.succeed(this.removed)[Symbol.iterator]();
  }
}

export const makeDb = (initial: Partial<Store> = {}) => {
  const store: Store = Object.fromEntries(
    Object.values(schema).map((table) => [tableName(table), []]),
  );

  for (const [key, rows] of Object.entries(initial))
    store[key] = (rows ?? []).map((row) => ({ ...row }));

  const query = Object.fromEntries(
    Object.entries(schema).map(([key, table]) => [
      key,
      {
        findFirst: ({ where }: { where?: any } = {}) =>
          Effect.sync(() => store[tableName(table)].find((row) => matches(where, row))),
        findMany: ({ where }: { where?: any } = {}) =>
          Effect.sync(() => store[tableName(table)].filter((row) => matches(where, row))),
      },
    ]),
  );

  const db: any = {
    store,
    query,
    insert: (table: any) => new InsertBuilder(store, tableName(table)),
    update: (table: any) => new UpdateBuilder(store, tableName(table)),
    delete: (table: any) => new DeleteBuilder(store, tableName(table)),
    select: (fields?: any) => new SelectBuilder(store, fields),
    // The production Db wraps this work in one transaction. The fake runs it
    // eagerly but restores the previous rows if it fails, so rollback paths are
    // observable without a database.
    transaction: <A, E, R>(work: (tx: any) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
      const snapshot = Object.fromEntries(
        Object.entries(store).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
      );

      const rollback = Effect.sync(() => {
        for (const [name, rows] of Object.entries(snapshot)) store[name] = rows;
      });

      return Effect.suspend(() => work(db)).pipe(Effect.onError(() => rollback));
    },
  };

  return db;
};

// SAFETY: tests provide every service layer before running, so no requirements
// remain at the boundary; `any` keeps the call sites free of layer plumbing.
export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E, any> | Promise<Effect.Effect<A, E, any>>,
) => Effect.runPromise((await effect) as Effect.Effect<A, E, never>);

export const request = (
  headers: Record<string, string> = {},
): HttpServerRequest.HttpServerRequest =>
  // SAFETY: handler tests only read `headers`; the service surfaces under test
  // never touch the method, URL or body stream of the request.
  ({ headers }) as HttpServerRequest.HttpServerRequest;

export const header = (response: any, name: string) =>
  response.headers?.get?.(name) ??
  response.headers?.[name.toLowerCase()] ??
  response.headers?.[name];

export const cookieFrom = (response: any) => header(response, "set-cookie")?.split(";")[0] ?? "";

const defaultStripeClient = () => ({
  customers: {
    search: async () => ({ data: [] }),
    list: async function* () {},
    create: async () => ({ id: "cus_created" }),
    update: async (id: string, params: { name?: string }) => ({ id, name: params.name ?? null }),
    retrieve: async (id: string) => ({ id, name: null }),
  },
  billingPortal: {
    sessions: {
      create: async ({ return_url }: { return_url: string }) => ({ url: return_url }),
    },
  },
  checkout: {
    sessions: {
      create: async ({ success_url }: { success_url: string }) => ({
        id: "cs_test_created",
        url: `https://checkout.stripe.test/${success_url}`,
      }),
    },
  },
  invoices: {
    list: async () => ({ data: [] }),
  },
  subscriptions: {
    retrieve: async (id: string) => ({ id, status: "active", items: { data: [] } }),
    update: async (id: string) => ({ id }),
    cancel: async (id: string) => ({ id }),
  },
});

/** Any Stripe method double for the members these billing paths call. */
type StripeClientDouble = (...args: Array<any>) => Promise<any>;

/** Per-test replacements merged one level into each Stripe namespace. */
type StripeClientOverrides = {
  readonly customers?: Partial<{
    search: StripeClientDouble;
    create: StripeClientDouble;
    update: StripeClientDouble;
    retrieve: StripeClientDouble;
  }>;
  readonly billingPortal?: {
    readonly sessions?: Partial<{ create: StripeClientDouble }>;
  };
  readonly checkout?: {
    readonly sessions?: Partial<{ create: StripeClientDouble }>;
  };
  readonly invoices?: Partial<{ list: StripeClientDouble }>;
  readonly subscriptions?: Partial<{
    retrieve: StripeClientDouble;
    update: StripeClientDouble;
    cancel: StripeClientDouble;
  }>;
};

/**
 * A partial Stripe SDK double covering the members the billing paths use.
 * The enterprise service accepts the real `Stripe` surface, so the double is
 * intentionally typed loosely rather than faking the whole SDK.
 */
export const makeStripeClient = (overrides: StripeClientOverrides = {}): any => {
  const client = defaultStripeClient();

  return {
    customers: { ...client.customers, ...overrides.customers },
    billingPortal: {
      sessions: { ...client.billingPortal.sessions, ...overrides.billingPortal?.sessions },
    },
    checkout: {
      sessions: { ...client.checkout.sessions, ...overrides.checkout?.sessions },
    },
    invoices: { ...client.invoices, ...overrides.invoices },
    subscriptions: { ...client.subscriptions, ...overrides.subscriptions },
  };
};
