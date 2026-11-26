import {
  CATALOGUE_CATEGORY_LABELS,
  CATALOGUE_PLATFORM_LABELS,
  CATALOGUE_PLATFORMS,
} from "./schema.js";
import type { CatalogueCategory, CataloguePlatform, CatalogueTitle } from "./schema.js";
import { catalogueMethodAvailability } from "./availability.js";
import { CATALOGUE_TITLES } from "./titles.js";

/**
 * Catalogue search.
 *
 * The dataset is a few dozen titles, not a storefront. A prebuilt, normalised
 * in-memory index is therefore both simpler and faster than an external search
 * service: the Worker already bundles this module, so a query is a few
 * comparisons over an array that is built once per process. Server-side search
 * keeps one ranking implementation for the dashboard, the API and MCP, and
 * lets the endpoint paginate without shipping the whole catalogue to each
 * browser.
 *
 * A bloom filter is deliberately absent. It can prove "definitely not present"
 * for an exact token, but it cannot rank a prefix, a substring or a typo, and a
 * filter that answers "maybe" still needs this scan behind it. For this size it
 * would add a data structure without removing work.
 */

export type CatalogueSearchRequest = {
  readonly q?: string;
  readonly category?: CatalogueCategory;
  readonly platform?: CataloguePlatform;
  /** Only titles with at least one deployment carried by this MDM platform. */
  readonly mdmPlatform?: "apple" | "win" | "android";
  readonly limit?: number;
  readonly offset?: number;
};

export type CatalogueFacet<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly count: number;
};

export type CatalogueSearchResult = {
  readonly items: ReadonlyArray<CatalogueTitle>;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly facets: {
    readonly categories: ReadonlyArray<CatalogueFacet<CatalogueCategory>>;
    readonly platforms: ReadonlyArray<CatalogueFacet<CataloguePlatform>>;
  };
};

export const CATALOGUE_SEARCH_DEFAULT_LIMIT = 24;
export const CATALOGUE_SEARCH_MAX_LIMIT = 100;

const MAX_QUERY_LENGTH = 120;

/** Lower-case, strip diacritics and fold punctuation into spaces. */
export const normaliseSearchText = (value: string): string =>
  value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();

const words = (value: string): ReadonlyArray<string> =>
  normaliseSearchText(value).split(" ").filter(Boolean);

/** Bounded Levenshtein distance; returns max + 1 once it is exceeded. */
const editDistance = (left: string, right: string, max: number): number => {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > max) return max + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let row = 1; row <= left.length; row++) {
    const current = [row];

    for (let column = 1; column <= right.length; column++) {
      const substitution = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1);
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution);
    }

    previous = current;
  }

  return previous[right.length]!;
};

const typoBudget = (token: string): number => (token.length >= 5 ? 2 : token.length >= 3 ? 1 : 0);

type SearchDocument = {
  readonly title: CatalogueTitle;
  readonly name: string;
  readonly vendor: string;
  readonly aliases: ReadonlyArray<string>;
  readonly categoryLabel: string;
  readonly categoryWords: ReadonlyArray<string>;
  readonly identifiers: ReadonlyArray<string>;
  readonly description: string;
  readonly notes: string;
  readonly nameWords: ReadonlyArray<string>;
  readonly vendorWords: ReadonlyArray<string>;
  readonly aliasWords: ReadonlyArray<string>;
};

const createDocument = (title: CatalogueTitle): SearchDocument => {
  const aliases = title.aliases.map(normaliseSearchText);
  const identifiers = title.deployments.flatMap((deployment) =>
    [
      deployment.bundleId,
      deployment.packageName,
      deployment.storeId,
      deployment.microsoftStoreId,
    ].flatMap((value) => (value ? [normaliseSearchText(value)] : [])),
  );

  return {
    title,
    name: normaliseSearchText(title.name),
    vendor: normaliseSearchText(title.vendor),
    aliases,
    categoryLabel: normaliseSearchText(CATALOGUE_CATEGORY_LABELS[title.category]),
    categoryWords: words(CATALOGUE_CATEGORY_LABELS[title.category]),
    identifiers,
    description: normaliseSearchText(title.description),
    notes: normaliseSearchText(title.notes ?? ""),
    nameWords: words(title.name),
    vendorWords: words(title.vendor),
    aliasWords: aliases.flatMap(words),
  };
};

export const CATALOGUE_INDEX: ReadonlyArray<SearchDocument> = CATALOGUE_TITLES.map(createDocument);

const exact = (value: string, token: string) => value === token;

const startsWith = (value: string, token: string) => value.startsWith(token);

const hasWordStarting = (values: ReadonlyArray<string>, token: string) =>
  values.some((value) => value.startsWith(token));

const contains = (value: string, token: string) => value.includes(token);

const bestTypo = (values: ReadonlyArray<string>, token: string): number => {
  const budget = typoBudget(token);

  if (budget === 0) return 0;

  let best = budget + 1;

  for (const value of values) {
    const distance = editDistance(token, value, budget);

    if (distance < best) best = distance;
  }

  return best <= budget ? best : 0;
};

/**
 * Score one token. A zero means the token is absent and the title is excluded
 * when any query token scores zero, which gives predictable AND semantics.
 */
const scoreToken = (document: SearchDocument, token: string): number => {
  let score = 0;

  if (exact(document.name, token)) score = Math.max(score, 1000);
  else if (startsWith(document.name, token)) score = Math.max(score, 620);
  else if (hasWordStarting(document.nameWords, token)) score = Math.max(score, 440);
  else if (contains(document.name, token)) score = Math.max(score, 180);

  if (document.aliases.some((alias) => alias === token)) score = Math.max(score, 720);
  else if (document.aliases.some((alias) => startsWith(alias, token))) score = Math.max(score, 330);
  else if (hasWordStarting(document.aliasWords, token)) score = Math.max(score, 300);

  if (exact(document.vendor, token)) score = Math.max(score, 280);
  else if (startsWith(document.vendor, token)) score = Math.max(score, 230);
  else if (hasWordStarting(document.vendorWords, token)) score = Math.max(score, 210);
  else if (contains(document.vendor, token)) score = Math.max(score, 90);

  if (exact(document.categoryLabel, token)) score = Math.max(score, 170);
  else if (hasWordStarting(document.categoryWords, token)) score = Math.max(score, 160);

  if (document.identifiers.some((identifier) => exact(identifier, token)))
    score = Math.max(score, 260);
  else if (document.identifiers.some((identifier) => contains(identifier, token)))
    score = Math.max(score, 90);

  if (contains(document.description, token)) score = Math.max(score, 45);
  if (contains(document.notes, token)) score = Math.max(score, 25);

  if (score === 0) {
    const distance = bestTypo(
      [
        document.name,
        document.vendor,
        ...document.nameWords,
        ...document.vendorWords,
        ...document.aliasWords,
      ],
      token,
    );

    if (distance > 0) score = 150 - distance * 35;
  }

  return score;
};

const scoreQuery = (
  document: SearchDocument,
  tokens: ReadonlyArray<string>,
): number | undefined => {
  if (tokens.length === 0) return 1;

  let total = 0;

  for (const token of tokens) {
    const score = scoreToken(document, token);

    if (score === 0) return undefined;

    total += score;
  }

  return total;
};

const matchesPlatform = (title: CatalogueTitle, platform: CataloguePlatform) =>
  title.platforms.includes(platform);

const matchesMdmPlatform = (title: CatalogueTitle, platform: "apple" | "win" | "android") =>
  title.deployments.some(
    (deployment) =>
      deployment.platform === platform &&
      catalogueMethodAvailability(deployment).status !== "unsupported",
  );

const uniqueTitles = (titles: ReadonlyArray<CatalogueTitle>) => {
  const seen = new Set<string>();

  return titles.filter((title) => {
    if (seen.has(title.id)) return false;

    seen.add(title.id);

    return true;
  });
};

const clampLimit = (limit: number | undefined) =>
  Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit!), 1), CATALOGUE_SEARCH_MAX_LIMIT)
    : CATALOGUE_SEARCH_DEFAULT_LIMIT;

const normaliseOffset = (offset: number | undefined) =>
  Number.isFinite(offset) ? Math.max(Math.trunc(offset!), 0) : 0;

const buildFacets = (slice: ReadonlyArray<SearchDocument>) => {
  const categories = new Map<CatalogueCategory, number>();
  const platforms = new Map<CataloguePlatform, number>();

  for (const document of slice) {
    categories.set(document.title.category, (categories.get(document.title.category) ?? 0) + 1);

    for (const platform of document.title.platforms)
      platforms.set(platform, (platforms.get(platform) ?? 0) + 1);
  }

  return {
    categories: (Object.entries(CATALOGUE_CATEGORY_LABELS) as Array<[CatalogueCategory, string]>)
      .filter(([value]) => (categories.get(value) ?? 0) > 0)
      .map(([value, label]) => ({ value, label, count: categories.get(value) ?? 0 })),
    platforms: CATALOGUE_PLATFORMS.flatMap((value) => {
      const count = platforms.get(value) ?? 0;

      return count > 0 ? [{ value, label: CATALOGUE_PLATFORM_LABELS[value], count }] : [];
    }),
  };
};

/**
 * Search the catalogue and return a page plus facet counts.
 *
 * Ranking is intended to be predictable rather than clever: an exact title
 * wins, an alias or title prefix comes next, then vendor and category matches,
 * with a bounded typo allowance for short queries. Popularity breaks ties and
 * is also the default order for an empty query.
 */
export const searchCatalogue = (
  request: CatalogueSearchRequest = {},
  titles: ReadonlyArray<CatalogueTitle> = CATALOGUE_TITLES,
): CatalogueSearchResult => {
  const index =
    titles === CATALOGUE_TITLES
      ? CATALOGUE_INDEX
      : uniqueTitles(titles).map((title) => createDocument(title));

  const rawQuery = (request.q ?? "").slice(0, MAX_QUERY_LENGTH).trim();
  const query = normaliseSearchText(rawQuery);
  const tokens = query.split(" ").filter(Boolean);
  const limit = clampLimit(request.limit);
  const offset = normaliseOffset(request.offset);

  // A query made only of CJK or punctuation normalises to an empty string.
  // Returning the whole catalogue would look like a successful search, so an
  // explicitly non-empty raw query with no searchable tokens returns nothing.
  const base =
    rawQuery !== "" && tokens.length === 0
      ? []
      : index.filter(
          (document) =>
            (!request.mdmPlatform || matchesMdmPlatform(document.title, request.mdmPlatform)) &&
            (!request.platform || matchesPlatform(document.title, request.platform)) &&
            scoreQuery(document, tokens) !== undefined,
        );

  const categoriesPool = base.filter(
    (document) => !request.category || document.title.category === request.category,
  );

  const matching = categoriesPool
    .map((document) => ({
      document,
      score: scoreQuery(document, tokens) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.document.title.popularity - left.document.title.popularity ||
        left.document.title.name.localeCompare(right.document.title.name),
    );

  const items = matching.slice(offset, offset + limit).map(({ document }) => document.title);

  return {
    items,
    total: matching.length,
    limit,
    offset,
    facets: buildFacets(base),
  };
};

/** A single title by its stable catalogue id. */
export const catalogueTitleById = (id: string): CatalogueTitle | undefined =>
  CATALOGUE_TITLES.find((title) => title.id === id);
