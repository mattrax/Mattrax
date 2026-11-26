/**
 * Re-export of the domain's entity query grammar.
 *
 * The parser, formatter and evaluator moved to the domain package so
 * the API applies exactly the same filters server-side. This module keeps the
 * import path used by the dashboard components stable.
 */
export {
  defaultFor,
  formatEntityQuery,
  joinEntityValues,
  matchesEntityQuery,
  opsFor,
  parseEntityQuery,
  splitEntityValues,
  type EntityCondition,
  type EntityField,
  type EntityFieldKind,
  type EntityFieldOption,
  type EntityQueryField,
} from "@mattrax/enterprise-domain/client";
