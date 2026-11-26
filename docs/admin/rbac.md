# Roles and permissions

Every tenant endpoint is guarded by a permission from the RBAC catalogue. The
built-in roles are fixed; owners and administrators with `roles.write` can create
custom roles for their organisation.

## Built-in roles

| Role          | Access                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| Owner         | All permissions, including deleting, exporting and backing up the tenant |
| Administrator | Runs the tenant; cannot delete, export or back up it                     |
| Member        | Read-only tenant data                                                    |
| Auditor       | Read-only tenant data, including audit history                           |

Webhook endpoints and delivery history are restricted to administrators and
owners. The approval queue is restricted the same way: `approvals.read` and
`approvals.write` are administrator/owner capabilities, not part of the
read-only member baseline.

## Custom roles

Open **Settings → Administrators → Roles**. Choose a name and tick the exact
permissions the role should have. Roles can cover devices, groups, policies,
applications, dashboards, enrollment, identity, platform management, webhooks,
audit, billing, backups, members, roles and tenant lifecycle.

Assign a role from the member list or when sending an invitation. A custom role
replaces the member's built-in role capabilities. Deleting a role requires
reassigning every member first.

Sensitive owner-only capabilities can be delegated deliberately: a custom role
can include `tenant.export`, `backups.read`, `backups.write` or
`tenant.delete`. Only an owner can change an owner's role.

## Approvals

Two permissions cover four-eyes approval:

| Permission        | Grants                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `approvals.read`  | View approval policies, the queue and the decisions on each request |
| `approvals.write` | Create/edit/delete policies and approve or reject requests          |

Every approver needs `approvals.write`. A policy can then narrow the set further
with one of:

- **A permission** (for example `devices.command` or `tenant.delete`). The
  approver's effective role must include it. Custom roles work here because the
  check uses effective permissions.
- **A built-in role**. The requirement is a floor (`owner` > `admin` >
  `member`/`auditor`), and a custom role never satisfies it because a custom
  role replaces the built-in capabilities.

The requester is always excluded from the count, even if they hold the required
permission or role. A requester can list and cancel their own requests with only
`tenant.read`; the full queue still requires `approvals.read`.

API tokens and MCP connections can hold these permissions in their ceiling, but
the approval decision endpoint refuses any bearer credential. A token can request
an approval; a signed-in administrator must decide it.

Policy configuration and decisions use the same permission catalogue as every
other endpoint, so a narrowed credential cannot read or decide approvals its
grant omits.

## Bulk role changes

Select several administrators in **Settings → Administrators** and choose a role
once. The same ceiling applies: you can only grant a role your own permissions
cover, and only an owner can change an owner's role or assign the owner role.
Rows the server refuses stay selected and the result names each one; rows that
already hold the chosen role count as successful, so retrying is safe. One audit
entry records the requested, updated and failed counts plus a bounded list of
account ids.

## Credentials use the same catalogue

API tokens and MCP OAuth connections carry their own permission ceiling,
selected from this catalogue. They never add authority: a request is allowed
only when both the credential grant **and** the account's role in that tenant
include the endpoint's permission. Read companions are added automatically (a
token granted `devices.write` can also list devices), and legacy `read`/`write`
scopes remain broad ceilings.

Narrowed credentials cannot manage account security settings (API tokens,
passkeys, profile), even when their tenant permissions are broad. The dashboard
token dialog, the MCP consent screen and the MCP tool list all derive from the
same grouped catalogue, so what a user selects is what the API enforces.

## Permission failures

A denied action returns a typed `EnterprisePermissionDenied` error containing the
permission, the effective role name and whether it is built-in or custom. The
dashboard renders a clear “Not allowed” message with that information.

## Audit attribution

Successful actions recorded in the audit log include the effective RBAC policy:

```json
{
  "rbac": {
    "permission": "policies.write",
    "roleName": "Helpdesk",
    "roleKind": "custom",
    "roleId": "…"
  }
}
```

Role creation, updates and deletion are audited separately, including the
permission set that was granted.

## Scope tags

Scope tags carve one tenant into regions, teams or schools so a delegated
administrator can be limited without a separate tenant.

- **Settings → Scope tags** creates a named tag with an optional description.
  A tenant can hold up to 100 tags. Deleting a tag requires removing it from
  every administrator first; resources carrying it become untagged.
- A tag can be attached to **devices, groups, policies, applications, scripts
  and dashboards**. Enrollment links are tenant-level settings rather than
  rows, so they cannot carry a tag yet; an enrollment administrator is
  tenant-wide. Device views and dashboard reports inherit the visibility of
  the data they query rather than carrying their own tag.
- Attach tags when creating a group, policy, application, script or dashboard,
  from a resource's **Scope tags** control, or in bulk from a list's selection
  bar. Attaching tags needs `scope_tags.write` **and** the write permission for
  that resource kind (`devices.write`, `groups.write`, and so on).
- On **Settings → Administrators**, a member or invitation can be given a set
  of allowed tags. A scoped member sees and changes only resources carrying at
  least one allowed tag. The role's permissions still apply: a request needs the
  permission *and* the tag.

### Defaults and upgrade behaviour

An administrator with **no allowed tags is unscoped** and sees the whole
tenant. This is the upgrade default: existing members keep exactly the access
they had, and no migration grants a scoped role access to anything. To scope an
administrator, give them at least one tag; to unscope them, clear the list.

A resource with **no tags is tenant-wide** and is visible only to unscoped
members. Scoped members never see untagged resources, so creating a scope
cannot silently widen a delegated team's reach. A scoped member creating a
group, policy, application, script or dashboard automatically attaches their
own tags to it; otherwise the new resource would disappear from their view.
Removing every tag from a resource makes it tenant-wide, so the API refuses
that for a scoped member.

Built-in **owners are always unscoped**, whatever tags are stored against
their membership. A tenant cannot lock itself out by tagging its owner. The
owner role cannot be given tags in the dashboard.

### Enforcement

Every guarded endpoint runs the RBAC permission check first. A scoped request
then also checks the resource's tags:

| Surface                            | Behaviour                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Lists and search                   | Only tagged resources in scope are returned                               |
| Read, update, delete               | Out-of-scope ids return 404/permission denied without changing anything    |
| Device commands and handover       | Refused unless the device is in scope                                      |
| Device export                      | CSV contains only in-scope devices                                         |
| Bulk actions                       | A mixed batch is refused before any row is changed; out-of-scope ids are reported like missing ids |
| Audit log and audit export         | Only entries about in-scope resources, plus device-linked activity         |
| Member tag assignment              | A scoped administrator cannot grant a wider scope than their own, edit a member outside their scope, or change their own tags |
| Assignment targets                 | Devices, groups, policies and child groups attached to a group, policy, script or application must be in scope |
| Tag editing                        | A scoped editor only replaces tags it can see; unseen tags stay attached. Creating tags, editing another tag, or deleting a tag used by a pending invitation is refused |

A denied cross-scope write/command is recorded as `scope_tag.access_denied`
with the attempted resource, the caller's tags and their role. Tag lifecycle
and assignment changes are recorded as `scope_tag.created`,
`scope_tag.updated`, `scope_tag.deleted`,
`scope_tag.assignments_changed` and `member.scope_tags_changed`.

Surfaces that can only be computed tenant-wide **fail closed** for a scoped
role with a clear permission error rather than exposing another region's
fleet: dashboard queries, dashboard reports and report sending, fleet health,
software-update, OS and push summaries, credential health, Windows failure
history without a device, device pre-registrations and imports, fleet migration
cohorts/exports, tenant export, backups and cutover, tenant onboarding counts,
the directory user list and the VPP licence pool. `getApplication` filters its
linked group/device names to the caller's scope. Tagged dashboards can still be
opened and edited by an in-scope administrator, but a scheduled report whose
creator is scoped is skipped. Device views remain tenant-wide query definitions,
not fleet data.

Device pre-registrations are not tagged because the device row does not exist
until enrolment; the same is true of the tenant's enrollment link, which is a
SCEP-signed setting rather than a resource row.

### Migration notes

The migration adds `scope_tag`, `scope_tag_assignment`,
`member_scope_tag` and an invitation `scope_tag_ids` column. No existing row is
tagged and no member is given a tag, so an upgrade preserves the previous
access exactly. Tags are opt-in per resource and per administrator.

