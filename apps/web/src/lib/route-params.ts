import { useLocation, useParams, useSearchParams } from "@solidjs/router";
import { Option, Schema } from "effect";
import {
  ApplicationRouteParams,
  DashboardRouteParams,
  DeviceRouteParams,
  GroupRouteParams,
  PolicyRouteParams,
  TenantRouteParams,
  UserRouteParams,
  decodeDeviceSearchParams,
} from "./routes";
import type { DeviceSearchParams } from "./routes";

/**
 * The tenant segment of the current URL, read from the committed location.
 *
 * `useParams()` is derived from the router's async match graph, so during
 * hydration or a pending navigation a read can be a pending async value. A
 * query key, an observer or a page that touches it from an untracked scope
 * would then suspend (or trip the strict-read diagnostic). The pathname is the
 * committed URL and is always a string, which is all a tenant key needs —
 * `resolveTenantId` turns the segment into the API's id either way.
 */
export const useTenantParam = (): (() => string | undefined) => {
  const location = useLocation();

  return () => {
    const raw = /^\/t\/([^/]+)/.exec(location.pathname)?.[1];

    if (raw === undefined) return undefined;

    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
};

/**
 * Typed readers for the file-based router. `useParams()` is an untyped record;
 * decoding it here keeps a missing or malformed segment from reaching a page as
 * a truthy string. Every reader returns `Partial` because a route can be
 * rendered before the router resolves its parameters.
 */
export const useTenantRouteParams = (): Partial<TenantRouteParams> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(TenantRouteParams)(useParams())) ?? {};

export const useDeviceRouteParams = (): Partial<DeviceRouteParams> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(DeviceRouteParams)(useParams())) ?? {};

export const useUserRouteParams = (): Partial<UserRouteParams> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(UserRouteParams)(useParams())) ?? {};

export const usePolicyRouteParams = (): Partial<PolicyRouteParams> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(PolicyRouteParams)(useParams())) ?? {};

export const useGroupRouteParams = (): Partial<GroupRouteParams> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(GroupRouteParams)(useParams())) ?? {};

export const useApplicationRouteParams = (): Partial<ApplicationRouteParams> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ApplicationRouteParams)(useParams())) ?? {};

export const useDashboardRouteParams = (): Partial<DashboardRouteParams> =>
  Option.getOrUndefined(Schema.decodeUnknownOption(DashboardRouteParams)(useParams())) ?? {};

/** Decoded, reactive device-list filters from the URL. */
export const useDeviceSearchParams = (): DeviceSearchParams => {
  const [search] = useSearchParams();

  return decodeDeviceSearchParams(search);
};
