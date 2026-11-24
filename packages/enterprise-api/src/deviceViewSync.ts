import {
  DeviceViewPrincipal,
  DeviceViewSyncError,
  DEVICE_VIEW_MAX_PRIVATE_VIEWS,
  DEVICE_VIEW_MAX_TENANT_VIEWS,
  PersonalDeviceViews,
  SyncedDeviceView,
  TenantDeviceViews,
  deviceViewOwnerId,
  deviceViewQueryWithinLimits,
} from "@mattrax/enterprise-domain";
import type { DeviceViewPatch } from "@mattrax/enterprise-domain";
import { normalizeDeviceSearchQuery } from "@mattrax/enterprise-backend";
import { ProtocolError } from "@yielded/sync";
import { Server } from "@yielded/sync/server";
import { Effect } from "effect";

const forbidden = (message: string) => ProtocolError.make({ reason: "Forbidden", message });

const rejected = (reason: (typeof DeviceViewSyncError.Type)["reason"], message: string) =>
  DeviceViewSyncError.make({ reason, message });

const validateQuery = (query: (typeof SyncedDeviceView.Type)["query"]) =>
  Effect.gen(function* () {
    if (!deviceViewQueryWithinLimits(query))
      return yield* rejected("Invalid", "The saved view query is too large.");

    yield* Effect.try({
      try: () =>
        normalizeDeviceSearchQuery({
          ...query,
          limit: query.pageSize ?? 50,
          offset: 0,
        }),
      catch: () => rejected("Invalid", "The saved view query is not valid device filters."),
    });
  });

const cleanDraft = (view: {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly query: (typeof SyncedDeviceView.Type)["query"];
  readonly createdByAccountId: string;
}) => ({
  id: view.id,
  name: view.name.trim().slice(0, 120),
  description: view.description?.trim().slice(0, 2_000) || null,
  query: view.query,
  createdByAccountId: view.createdByAccountId,
});

const duplicateName = (views: ReadonlyArray<SyncedDeviceView>, name: string, exceptId?: string) =>
  views.some((view) => view.id !== exceptId && view.name === name);

const requireView = (views: ReadonlyArray<SyncedDeviceView>, id: string) =>
  Effect.gen(function* () {
    const view = views.find((candidate) => candidate.id === id);

    if (!view) return yield* rejected("NotFound", "View not found.");

    return view;
  });

const sharedAuthorize = (
  principal: DeviceViewPrincipal,
  address: { readonly id: string },
  operation: { readonly _tag: string },
): Effect.Effect<void, ProtocolError> =>
  Effect.gen(function* () {
    if (principal.tenantId !== address.id)
      return yield* forbidden("The view belongs to another tenant.");

    const permission =
      operation._tag === "action" || operation._tag === "result" ? "devices.write" : "devices.read";

    if (!principal.permissions.includes(permission))
      return yield* forbidden(`This connection does not include ${permission}.`);
  });

const personalAuthorize = (
  principal: DeviceViewPrincipal,
  address: { readonly id: string },
): Effect.Effect<void, ProtocolError> =>
  Effect.gen(function* () {
    if (address.id !== deviceViewOwnerId(principal.tenantId, principal.accountId))
      return yield* forbidden("The view belongs to another account.");

    if (!principal.permissions.includes("devices.read"))
      return yield* forbidden("This connection does not include devices.read.");
  });

const updateView = (views: ReadonlyArray<SyncedDeviceView>, patch: DeviceViewPatch) =>
  Effect.gen(function* () {
    const current = yield* requireView(views, patch.id);
    const name = patch.name?.trim().slice(0, 120);

    if (name !== undefined && !name) return yield* rejected("Invalid", "View name is required.");
    if (name !== undefined && duplicateName(views, name, patch.id))
      return yield* rejected("Duplicate", "You already have a view with that name.");
    if (patch.query !== undefined) yield* validateQuery(patch.query);

    const view: SyncedDeviceView = {
      ...current,
      ...(name === undefined ? {} : { name }),
      ...(patch.description === undefined
        ? {}
        : { description: patch.description?.trim().slice(0, 2_000) || null }),
      ...(patch.query === undefined ? {} : { query: patch.query }),
      updatedAt: new Date().toISOString(),
    };

    return {
      views: [...views.filter((candidate) => candidate.id !== patch.id), view],
      events: [{ _tag: "Upsert" as const, view }],
    };
  });

export const TenantDeviceViewsServer: Server.Definition<typeof TenantDeviceViews.spec> =
  Server.make(TenantDeviceViews, {
    principal: DeviceViewPrincipal,
    state: TenantDeviceViews.spec.snapshot,
    initialize: Effect.succeed({ views: [] }),
    snapshot: (state) => state,
    authorize: ({ principal, address, operation }) =>
      sharedAuthorize(principal, address, operation),
    actions: {
      create: Effect.fn("TenantDeviceViews.create")(function* ({ state, payload, principal }) {
        const view = cleanDraft(payload.view);
        yield* validateQuery(view.query);

        if (!view.name) return yield* rejected("Invalid", "View name is required.");
        if (state.views.length >= DEVICE_VIEW_MAX_TENANT_VIEWS)
          return yield* rejected("Limit", "This tenant has reached its saved-view limit.");
        if (state.views.some((candidate) => candidate.id === view.id))
          return yield* rejected("Duplicate", "That view id already exists.");
        if (duplicateName(state.views, view.name))
          return yield* rejected("Duplicate", "A tenant view with that name already exists.");

        const timestamp = new Date().toISOString();
        const record: SyncedDeviceView = {
          ...view,
          createdByAccountId: principal.accountId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        return {
          state: { views: [...state.views, record] },
          events: [{ _tag: "Upsert" as const, view: record }],
          result: { id: record.id },
        };
      }),
      update: Effect.fn("TenantDeviceViews.update")(function* ({ state, payload }) {
        const next = yield* updateView(state.views, payload);

        return {
          state: { views: next.views },
          events: next.events,
          result: undefined,
        };
      }),
      delete: Effect.fn("TenantDeviceViews.delete")(function* ({ state, payload }) {
        yield* requireView(state.views, payload.id);

        return {
          state: { views: state.views.filter((view) => view.id !== payload.id) },
          events: [{ _tag: "Remove" as const, id: payload.id }],
          result: undefined,
        };
      }),
    },
  });

export const PersonalDeviceViewsServer: Server.Definition<typeof PersonalDeviceViews.spec> =
  Server.make(PersonalDeviceViews, {
    principal: DeviceViewPrincipal,
    state: PersonalDeviceViews.spec.snapshot,
    initialize: Effect.succeed({ views: [], defaultViewId: null }),
    snapshot: (state) => state,
    authorize: ({ principal, address }) => personalAuthorize(principal, address),
    actions: {
      create: Effect.fn("PersonalDeviceViews.create")(function* ({ state, payload, principal }) {
        const view = cleanDraft(payload.view);
        yield* validateQuery(view.query);

        if (!view.name) return yield* rejected("Invalid", "View name is required.");
        if (state.views.length >= DEVICE_VIEW_MAX_PRIVATE_VIEWS)
          return yield* rejected("Limit", "You have reached your saved-view limit.");
        if (state.views.some((candidate) => candidate.id === view.id))
          return yield* rejected("Duplicate", "That view id already exists.");
        if (duplicateName(state.views, view.name))
          return yield* rejected("Duplicate", "You already have a view with that name.");

        const timestamp = new Date().toISOString();
        const record: SyncedDeviceView = {
          ...view,
          createdByAccountId: principal.accountId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        return {
          state: { ...state, views: [...state.views, record] },
          events: [{ _tag: "Upsert" as const, view: record }],
          result: { id: record.id },
        };
      }),
      update: Effect.fn("PersonalDeviceViews.update")(function* ({ state, payload }) {
        const next = yield* updateView(state.views, payload);

        return {
          state: { ...state, views: next.views },
          events: next.events,
          result: undefined,
        };
      }),
      delete: Effect.fn("PersonalDeviceViews.delete")(function* ({ state, payload }) {
        yield* requireView(state.views, payload.id);

        return {
          state: {
            views: state.views.filter((view) => view.id !== payload.id),
            defaultViewId: state.defaultViewId === payload.id ? null : state.defaultViewId,
          },
          events: [{ _tag: "Remove" as const, id: payload.id }],
          result: undefined,
        };
      }),
      setDefault: Effect.fn("PersonalDeviceViews.setDefault")(function* ({ state, payload }) {
        yield* Effect.void;

        return {
          state: { ...state, defaultViewId: payload.viewId },
          events: [{ _tag: "SetDefault" as const, viewId: payload.viewId }],
          result: undefined,
        };
      }),
    },
  });
