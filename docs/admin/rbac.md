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
