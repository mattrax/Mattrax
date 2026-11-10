import { Schema } from "effect";

/**
 * Fields come back as `null` when Entra has no value for them, so wire schemas
 * accept `null` and the mappers below normalise it to `undefined`.
 */
const optionalString = Schema.optional(Schema.NullOr(Schema.String));
const optionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean));

const RemovedReason = Schema.Struct({
  reason: Schema.optional(Schema.NullOr(Schema.String)),
});
type RemovedReason = typeof RemovedReason.Type;

const GraphUserWire = Schema.Struct({
  id: Schema.String,
  displayName: optionalString,
  mail: optionalString,
  userPrincipalName: optionalString,
  accountEnabled: optionalBoolean,
  givenName: optionalString,
  surname: optionalString,
  userType: optionalString,
  "@removed": Schema.optional(RemovedReason),
});

/** A user returned by `/users/delta`. */
export type GraphUser = {
  readonly id: string;
  readonly displayName?: string;
  readonly mail?: string;
  readonly userPrincipalName?: string;
  readonly accountEnabled?: boolean;
  readonly givenName?: string;
  readonly surname?: string;
  readonly userType?: string;
  /** Present when the user was removed from (or changed in) the directory. */
  readonly removed?: boolean;
};

export function graphUserFromWire(user: typeof GraphUserWire.Type): GraphUser {
  const reason: RemovedReason | undefined = user["@removed"];
  return {
    id: user.id,
    displayName: user.displayName ?? undefined,
    mail: user.mail ?? undefined,
    userPrincipalName: user.userPrincipalName ?? undefined,
    accountEnabled: user.accountEnabled ?? undefined,
    givenName: user.givenName ?? undefined,
    surname: user.surname ?? undefined,
    userType: user.userType ?? undefined,
    removed: reason === undefined ? undefined : true,
  };
}

const GraphGroupMemberWire = Schema.Struct({
  id: Schema.String,
  "@odata.type": Schema.optional(Schema.NullOr(Schema.String)),
  "@removed": Schema.optional(RemovedReason),
});

/** A membership change returned inside a group's `members@delta`. */
export type GraphGroupMember = {
  readonly id: string;
  /** Graph object type without the `#microsoft.graph.` prefix, e.g. `user`. */
  readonly type: string;
  /** Present when the member was removed from the group. */
  readonly removed?: boolean;
};

function memberType(type: string | null | undefined): string {
  if (!type) return "unknown";
  return type.replace(/^#microsoft\.graph\./, "");
}

export function graphGroupMemberFromWire(
  member: typeof GraphGroupMemberWire.Type,
): GraphGroupMember {
  return {
    id: member.id,
    type: memberType(member["@odata.type"]),
    removed: member["@removed"] === undefined ? undefined : true,
  };
}

const GraphGroupWire = Schema.Struct({
  id: Schema.String,
  displayName: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  "members@delta": Schema.optional(Schema.NullOr(Schema.Array(GraphGroupMemberWire))),
  "@removed": Schema.optional(RemovedReason),
});

/** A group returned by `/groups/delta`. */
export type GraphGroup = {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly members?: ReadonlyArray<GraphGroupMember>;
  /** Present when the group was removed from (or changed in) the directory. */
  readonly removed?: boolean;
};

export function graphGroupFromWire(group: typeof GraphGroupWire.Type): GraphGroup {
  const members = group["members@delta"];
  return {
    id: group.id,
    displayName: group.displayName ?? "",
    description: group.description ?? undefined,
    members:
      members === undefined || members === null ? undefined : members.map(graphGroupMemberFromWire),
    removed: group["@removed"] === undefined ? undefined : true,
  };
}

/** A domain owned by the Entra tenant. */
export const GraphDomainSchema = Schema.Struct({
  id: Schema.String,
  isVerified: Schema.Boolean,
  isDefault: Schema.Boolean,
  isInitial: Schema.Boolean,
});
export type GraphDomain = typeof GraphDomainSchema.Type;

export const GraphUserDeltaResponse = Schema.Struct({
  value: Schema.optional(Schema.Array(GraphUserWire)),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
  "@odata.deltaLink": Schema.optional(Schema.NullOr(Schema.String)),
});
export type GraphUserDeltaResponse = typeof GraphUserDeltaResponse.Type;

export const GraphGroupDeltaResponse = Schema.Struct({
  value: Schema.optional(Schema.Array(GraphGroupWire)),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
  "@odata.deltaLink": Schema.optional(Schema.NullOr(Schema.String)),
});
export type GraphGroupDeltaResponse = typeof GraphGroupDeltaResponse.Type;

export const GraphDomainsResponse = Schema.Struct({
  value: Schema.Array(GraphDomainSchema),
  "@odata.nextLink": Schema.optional(Schema.NullOr(Schema.String)),
});
export type GraphDomainsResponse = typeof GraphDomainsResponse.Type;

/**
 * One page of a Graph delta query. Pass `nextLink` back into the same delta
 * method until it is `null`; persist `deltaLink` for the next sync.
 */
export type GraphDeltaPage<T> = {
  readonly items: ReadonlyArray<T>;
  readonly nextLink: string | null;
  readonly deltaLink: string | null;
};
