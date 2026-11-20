# Accounts and users

Mattrax has two person-shaped identities. They are deliberately separate: one is an
administrator of the dashboard, the other is a person managed on a device.

## Definitions

An **account** is a dashboard administrator.

- Created by registering on the Mattrax website, by accepting a tenant invitation, or by
  an explicitly enabled SSO first-sign-in.
- Owns credentials: passkeys, an optional authenticator app, sessions, recovery codes and
  API/MCP tokens.
- Belongs to one or more tenants through a **member** row, which carries the role and any
  custom RBAC role.
- Is the actor in audit entries, ownership transfers, invitations and billing.
- Is the only identity that can authenticate to the dashboard or API.

A **user** is a person from a tenant's directory.

- Belongs to exactly one tenant and has no credentials, sessions or tenant role.
- Has a name, email, optional provider object id (`externalId`), a source (`entra`,
  `scim` or `manual`) and a disabled flag.
- Is provisioned by Entra directory sync or SCIM. Administrators can also create one.
- Is used to scope policies, directory groups and device links to a person, and to resolve
  the MDM user channel.
- Can never sign in, call the API, or read a tenant. It grants no authority.

The same human may be both an account and a user. They remain two rows with two ids and two
lifecycles. Creating an account does not create a directory user, and syncing a directory
does not create an account.

## Why the split exists

The two identities answer different questions:

| Question                                                   | Identity |
| ---------------------------------------------------------- | -------- |
| Who may change this tenant's policies?                     | Account  |
| Who is signed in on this Mac, and receives their policies? | User     |
| Who owns this audit entry?                                 | Account  |
| Whose device is this?                                      | User     |
| Who receives this invitation or billing email?             | Account  |
| Which people are in this Entra group?                      | User     |

Conflating them made every directory person a potential dashboard account with a role,
membership, invitation lifecycle and SSO identity. It also made the `user` table the
authority for authentication and for device scoping at the same time. The split makes
directory data tenant-scoped and read-only, and keeps authentication and RBAC in
`account`.

## Lifecycle

### Account

1. Registration proves the email, creates a passkey and inserts an `account`.
2. The account creates a tenant (becoming its owner) or accepts an invitation, which
   inserts a `member`.
3. Roles, custom roles and ownership transfer only ever move `member` rows between
   accounts.
4. Deleting an account removes its credentials, sessions, tokens, memberships and SSO
   links. Its tenant-scoped directory `user` rows, device links and user policies remain:
   they describe a person on a device, not a dashboard identity.

### User

1. Directory sync upserts by provider object id (`externalId`) first, then by email within
   the tenant.
2. Group sync links the user into `user_group_member`.
3. Administrators link users to devices in `device_user`; policies can target the user
   directly (`user_policy`) or through a directory group (`user_group_policy`).
4. A removed or disabled directory object sets `user.disabled`, removes its directory group
   memberships and stops policy delivery. The row is retained so history and device links
   stay meaningful.
5. SCIM delete removes the directory row; foreign keys cascade its group memberships,
   device links and user policies.
6. An administrator can merge directory rows that describe the same person. The
   merge moves device links, group memberships, direct policies, group exclusions
   and Apple user channels to the target, keeps the target's edge on a collision,
   and removes the duplicate rows. It never touches accounts or `sso_identity`.
   See [Merging duplicate directory people](/admin/identity#merging-duplicate-directory-people).

## Directory sync and SSO

Directory sync and SSO are different flows with different outputs:

- **Directory sync** (Entra Graph, SCIM) maintains `user` rows. It never creates accounts,
  members, invitations or SSO identities. The Entra `autoProvision` setting no longer
  affects directory sync: directory people are always imported.
- **SSO sign-in** authenticates an account. When the tenant enables auto-provisioning, the
  first SSO sign-in for an unknown email creates an `account` and a `member` so the person
  can administer the dashboard. That account is not linked automatically to a directory
  user by email; the directory user is a separate record.

This means an organisation can sync its whole staff directory for device policy without
giving anyone dashboard access. Dashboard access is granted explicitly through membership,
invitations, or the tenant's SSO auto-provision setting.

## API

| Surface                                              | Identity                                      |
| ---------------------------------------------------- | --------------------------------------------- |
| `GET /v1/me`                                         | Returns `{ account, tenants }`                |
| `GET /v1/tenants/:id/accounts`                       | Tenant administrators (`TenantAccount` rows)  |
| `PATCH/DELETE /v1/tenants/:id/accounts/:accountId`   | Change an administrator's role or remove them |
| `POST /v1/tenants/:id/invitations`                   | Invite an account by email                    |
| `GET /v1/tenants/:id/directory`                      | `{ users, groups }` directory data            |
| `GET/PUT /v1/tenants/:id/devices/:id/users`          | Directory users linked to a device            |
| `GET /v1/tenants/:id/users/:userId/merge-candidates` | Likely duplicate directory people             |
| `POST /v1/tenants/:id/users/:userId/merge-preview`   | Dry run of a directory merge                  |
| `POST /v1/tenants/:id/users/:userId/merge`           | Fold duplicate directory people together      |
| Policy `assignUsers` / `assignUserGroups`            | Directory users and directory groups          |

An account is identified by `accountId`. A directory user is identified by `userId` on
device and policy endpoints, and by its `id` in directory responses.

## Database

| Table                              | Identity         | Notes                                                                                                  |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `account`                          | Account          | Authentication, MFA, sessions, default tenant                                                          |
| `member`                           | Account ↔ tenant | `account_id`, role, custom role                                                                        |
| `account_*`                        | Account          | Audit, sessions, email change, recovery, API tokens                                                    |
| `sso_identity`                     | Account ↔ IdP    | Links an account to a tenant's SSO object for sign-in                                                  |
| `user`                             | User             | Tenant-scoped directory person; unique `(organization_id, email)` and `(organization_id, external_id)` |
| `user_group`, `user_group_member`  | User             | Directory groups and membership                                                                        |
| `device_user`                      | User ↔ device    | Linked people on a device                                                                              |
| `user_policy`, `user_group_policy` | User             | User-scoped policy assignment                                                                          |

Account-owned tables use `account_id` fields (`subject_account_id`, `actor_account_id`,
`created_by_account_id`, and so on). Directory-scoped link tables keep `user_id`.

## Invariants

- No authentication, session, API token or MCP token resolves to a `user`.
- No `user` has a `member`, role, passkey, email verification or default tenant.
- Every `user` belongs to exactly one organization.
- A policy user assignment, device link or directory group member id must be a user in
  the same organization.
- A directory merge moves only user-scoped rows. It never merges accounts,
  memberships or SSO identity links, and it is the only directory mutation the
  user page exposes.
- Directory sync never creates, promotes, demotes or deletes an account.
- Removing an account never deletes a directory user, its device links or its user
  policies.
- Disabled users do not contribute policies; disabled accounts cannot authenticate and
  their memberships grant nothing.

## Migrating from the pre-split model

The migration in `apps/cloud/migrations/20261118080000_account-user-split`:

1. Renames the old `user` table to `account` and moves every account-owned foreign key and
   column with it.
2. Creates the new tenant-scoped `user` table.
3. Creates a directory user for every directory-provisioned account (`source` `graph` or
   `scim`) and for every account referenced by device links, user policies or direct group
   memberships, preserving the person's `externalId` from `sso_identity`.
4. Remaps `device_user`, `user_policy` and `user_group_member` to the new user ids.
5. Leaves existing accounts and memberships in place, so no administrator loses access.

New directory sync no longer creates accounts. Existing directory-provisioned accounts
remain until an administrator removes them; they are not recreated.
