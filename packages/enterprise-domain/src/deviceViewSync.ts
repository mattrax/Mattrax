import { Action, Source } from "@yielded/sync";
import { Client } from "@yielded/sync/client";
import { Schema } from "effect";
import { Permission } from "./rbac.js";
import { DeviceViewQuery } from "./Search.js";

export const DEVICE_VIEW_MAX_QUERY_BYTES = 8_192;
export const DEVICE_VIEW_MAX_TENANT_VIEWS = 100;
export const DEVICE_VIEW_MAX_PRIVATE_VIEWS = 100;

const ViewId = Schema.NonEmptyString.check(Schema.isMaxLength(128));
const ViewName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120));
const ViewDescription = Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_000)));
const ViewTimestamp = Schema.String.check(Schema.isMaxLength(64));

/** The durable record. Presentation flags are derived by each browser. */
export const SyncedDeviceView = Schema.Struct({
  id: ViewId,
  name: ViewName,
  description: ViewDescription,
  query: DeviceViewQuery,
  createdByAccountId: Schema.NullOr(ViewId),
  createdAt: ViewTimestamp,
  updatedAt: ViewTimestamp,
});

export type SyncedDeviceView = typeof SyncedDeviceView.Type;

export const DeviceViewDraft = Schema.Struct({
  id: ViewId,
  name: ViewName,
  description: ViewDescription,
  query: DeviceViewQuery,
  /** Used only for the optimistic replica; the server replaces it with the principal. */
  createdByAccountId: ViewId,
});

export const DeviceViewPatch = Schema.Struct({
  id: ViewId,
  name: Schema.optional(ViewName),
  description: Schema.optional(ViewDescription),
  query: Schema.optional(DeviceViewQuery),
});

export type DeviceViewPatch = typeof DeviceViewPatch.Type;

export const DeviceViewId = Schema.Struct({ id: ViewId });

export class DeviceViewSyncError extends Schema.TaggedError<DeviceViewSyncError>()(
  "DeviceViewSyncError",
  {
    reason: Schema.Literals(["Invalid", "Duplicate", "Limit", "NotFound"]),
    message: Schema.String,
  },
) {}

const Upsert = Schema.TaggedStruct("Upsert", { view: SyncedDeviceView });
const Remove = Schema.TaggedStruct("Remove", { id: ViewId });
const SetDefault = Schema.TaggedStruct("SetDefault", { viewId: Schema.NullOr(ViewId) });

const Create = Action.make("create", {
  payload: Schema.Struct({ view: DeviceViewDraft }),
  success: Schema.Struct({ id: ViewId }),
  error: DeviceViewSyncError,
});

const Update = Action.make("update", {
  payload: DeviceViewPatch,
  success: Schema.Void,
  error: DeviceViewSyncError,
});

const Delete = Action.make("delete", {
  payload: DeviceViewId,
  success: Schema.Void,
  error: DeviceViewSyncError,
});

const SetDefaultAction = Action.make("setDefault", {
  payload: Schema.Struct({ viewId: Schema.NullOr(ViewId) }),
  success: Schema.Void,
  error: DeviceViewSyncError,
});

/** Trusted principal produced by Mattrax authentication, never by the client. */
export const DeviceViewPrincipal = Schema.Struct({
  actorId: Schema.NonEmptyString,
  tenantId: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  permissions: Schema.Array(Permission),
});

export type DeviceViewPrincipal = typeof DeviceViewPrincipal.Type;

export const deviceViewOwnerId = (tenantId: string, accountId: string) =>
  `${tenantId}:${accountId}`;

export const deviceViewTenantId = (ownerId: string) => {
  const separator = ownerId.indexOf(":");

  return separator === -1 ? ownerId : ownerId.slice(0, separator);
};

/** Tenant-published views. Every authorized member receives the same snapshot. */
export const TenantDeviceViews = Source.make({
  kind: "device-views-tenant",
  path: "/api/sync/device-views/tenant",
  id: Schema.NonEmptyString,
  schemaVersion: 1,
  snapshot: Schema.Struct({
    views: Schema.Array(SyncedDeviceView).check(Schema.isMaxLength(DEVICE_VIEW_MAX_TENANT_VIEWS)),
  }),
  event: Schema.Union([Upsert, Remove]),
  actions: [Create, Update, Delete],
});

/** Private views and the member's default. The source id binds tenant + account. */
export const PersonalDeviceViews = Source.make({
  kind: "device-views-personal",
  path: "/api/sync/device-views/personal",
  id: Schema.NonEmptyString,
  schemaVersion: 1,
  snapshot: Schema.Struct({
    views: Schema.Array(SyncedDeviceView).check(Schema.isMaxLength(DEVICE_VIEW_MAX_PRIVATE_VIEWS)),
    defaultViewId: Schema.NullOr(ViewId),
  }),
  event: Schema.Union([Upsert, Remove, SetDefault]),
  actions: [Create, Update, Delete, SetDefaultAction],
});

const sortViews = (views: ReadonlyArray<SyncedDeviceView>) =>
  [...views].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );

type SharedSnapshot = { readonly views: ReadonlyArray<SyncedDeviceView> };
type PersonalSnapshot = {
  readonly views: ReadonlyArray<SyncedDeviceView>;
  readonly defaultViewId: string | null;
};

const reduceShared = (
  snapshot: SharedSnapshot,
  event: typeof TenantDeviceViews.spec.event.Type,
): SharedSnapshot => {
  switch (event._tag) {
    case "Upsert":
      return {
        views: sortViews([
          ...snapshot.views.filter((view) => view.id !== event.view.id),
          event.view,
        ]),
      };
    case "Remove":
      return { views: snapshot.views.filter((view) => view.id !== event.id) };
  }
};

const reducePersonal = (
  snapshot: PersonalSnapshot,
  event: typeof PersonalDeviceViews.spec.event.Type,
): PersonalSnapshot => {
  switch (event._tag) {
    case "Upsert":
      return {
        ...snapshot,
        views: sortViews([
          ...snapshot.views.filter((view) => view.id !== event.view.id),
          event.view,
        ]),
      };
    case "Remove":
      return {
        views: snapshot.views.filter((view) => view.id !== event.id),
        defaultViewId: snapshot.defaultViewId === event.id ? null : snapshot.defaultViewId,
      };
    case "SetDefault":
      return { ...snapshot, defaultViewId: event.viewId };
  }
};

export const TenantDeviceViewsClient = Client.definition(TenantDeviceViews, {
  applyEvent: reduceShared,
  optimistic: {
    create: (snapshot, { view }) => ({
      views: sortViews([...snapshot.views, { ...view, createdAt: "", updatedAt: "" }]),
    }),
    update: (snapshot, patch) => ({
      views: sortViews(
        snapshot.views.map((view) =>
          view.id === patch.id
            ? {
                ...view,
                ...(patch.name === undefined ? {} : { name: patch.name }),
                ...(patch.description === undefined ? {} : { description: patch.description }),
                ...(patch.query === undefined ? {} : { query: patch.query }),
                updatedAt: "",
              }
            : view,
        ),
      ),
    }),
    delete: (snapshot, { id }) => ({
      views: snapshot.views.filter((view) => view.id !== id),
    }),
  },
});

export const PersonalDeviceViewsClient = Client.definition(PersonalDeviceViews, {
  applyEvent: reducePersonal,
  optimistic: {
    create: (snapshot, { view }) => ({
      ...snapshot,
      views: sortViews([...snapshot.views, { ...view, createdAt: "", updatedAt: "" }]),
    }),
    update: (snapshot, patch) => ({
      ...snapshot,
      views: sortViews(
        snapshot.views.map((view) =>
          view.id === patch.id
            ? {
                ...view,
                ...(patch.name === undefined ? {} : { name: patch.name }),
                ...(patch.description === undefined ? {} : { description: patch.description }),
                ...(patch.query === undefined ? {} : { query: patch.query }),
                updatedAt: "",
              }
            : view,
        ),
      ),
    }),
    delete: (snapshot, { id }) => ({
      views: snapshot.views.filter((view) => view.id !== id),
      defaultViewId: snapshot.defaultViewId === id ? null : snapshot.defaultViewId,
    }),
    setDefault: (snapshot, { viewId }) => ({ ...snapshot, defaultViewId: viewId }),
  },
});

export const deviceViewQueryWithinLimits = (query: DeviceViewQuery) =>
  new TextEncoder().encode(JSON.stringify(query)).byteLength <= DEVICE_VIEW_MAX_QUERY_BYTES;
