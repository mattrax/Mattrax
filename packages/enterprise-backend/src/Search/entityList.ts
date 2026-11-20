import { Option, Schema } from "effect";
import {
  EnterpriseBadRequest,
  parseEntityQuery,
  type EntityCondition,
  type EntityQueryField,
  type SortDirection,
} from "@mattrax/enterprise-domain";

/**
 * Normalisation for the server-paginated entity lists (groups, policies and
 * applications).
 *
 * Like the device search query, the rules for page bounds and filter parsing
 * are pure so they can be unit tested without a database. The API handler only
 * turns the result into SQL.
 */

export const ENTITY_LIST_DEFAULT_LIMIT = 50;

/** A page never returns more than this, however large a request asks for. */
export const ENTITY_LIST_MAX_LIMIT = 200;

export type EntityListQuery = {
  readonly q?: string;
  readonly query?: string;
  /** HTTP query values arrive as text; both forms are coerced and clamped. */
  readonly limit?: number | string;
  readonly offset?: number | string;
  readonly direction?: SortDirection;
};

export type NormalizedEntityListQuery<Sort extends string> = {
  readonly q?: string;
  /** Parsed conditions; unknown fields and operators are dropped. */
  readonly conditions: ReadonlyArray<EntityCondition>;
  readonly limit: number;
  readonly offset: number;
  readonly sort: Sort;
  readonly direction: SortDirection;
};

const NumericQueryValue = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

/** Coerce a query-string value (or JSON number) into an integer. */
const integer = (value: number | string | undefined, fallback: number) => {
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(NumericQueryValue)(value));

  return parsed === undefined ? fallback : Math.trunc(parsed);
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const optionalText = (value: string | undefined) => {
  const text = value?.trim();

  return text ? text : undefined;
};

/**
 * Bound the page, pick a deterministic order and parse the filter text.
 *
 * `sorts` is the entity's closed sort list in declaration order; an absent or
 * unknown sort falls back to the first entry (name) so every offset page sees
 * the same ordering.
 */
export const normalizeEntityListQuery = <Sort extends string>(
  query: EntityListQuery & { readonly sort?: Sort },
  sorts: ReadonlyArray<Sort>,
  fields: ReadonlyArray<EntityQueryField>,
): NormalizedEntityListQuery<Sort> => {
  const fallback = sorts[0];

  if (fallback === undefined)
    throw new EnterpriseBadRequest({ message: "This list has no sortable columns" });

  const sort = query.sort !== undefined && sorts.includes(query.sort) ? query.sort : fallback;

  return {
    q: optionalText(query.q),
    conditions: parseEntityQuery(query.query, fields),
    limit: clamp(integer(query.limit, ENTITY_LIST_DEFAULT_LIMIT), 1, ENTITY_LIST_MAX_LIMIT),
    offset: Math.max(integer(query.offset, 0), 0),
    sort,
    direction: query.direction ?? "asc",
  };
};
