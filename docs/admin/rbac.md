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
owners.

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
