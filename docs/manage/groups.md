# Groups

Groups decide which devices receive a policy or application. Mattrax supports manual
groups and rule-based dynamic groups.

## Manual groups

Create a group and add devices explicitly. Manual groups are predictable and are the right
choice for small fleets, exceptions and pilot rings.

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Macs", "kind": "manual" }'
```

Add devices and policies:

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$GROUP_ID/members" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assign": {
      "devices": ["device_id"],
      "policies": ["policy_id", { "id": "other_policy", "mode": "exclude" }]
    },
    "unassign": { "devices": [], "policies": [] }
  }'
```

### Choosing members in the dashboard

A manual group's **Devices** and **Policies** tabs use the shared table with a search
field, server-side pagination (50 devices per page) and the usual keyboard bindings.
Device search matches the management name, serial number and asset tag, so a specific
machine can be found in a few-thousand-device fleet without loading every row. The
header checkbox, **Add all shown** and **Include all shown** apply the displayed page
in one step; the footer states which page and how many rows the group contains, and
changes remain staged until **Save**.

## Dynamic groups

A dynamic group stores a versioned rule set and materialises matching devices into
`group_device` with `source = 'dynamic'`.

### Rule shape

```json
{
  "version": 1,
  "all": [
    { "field": "platform", "op": "eq", "value": "apple" },
    { "field": "osVersion", "op": "gte", "value": "14.0" }
  ],
  "any": [
    { "field": "model", "op": "contains", "value": "MacBook" },
    { "field": "assetTag", "op": "prefix", "value": "FIN-" }
  ],
  "none": [{ "field": "health", "op": "eq", "value": "critical" }]
}
```

Semantics: every `all` condition must match, at least one `any` condition must match, and
no `none` condition may match. An empty rule set matches nothing.

### Fields and operators

| Field                      | Operators                                                                |
| -------------------------- | ------------------------------------------------------------------------ |
| `platform` (alias `proto`) | `eq`                                                                     |
| `osVersion`                | `eq`, `lt`, `lte`, `gt`, `gte` (numeric dotted compare)                  |
| `model`                    | `contains`, `eq` (case-insensitive)                                      |
| `serial`                   | `prefix`, `eq`                                                           |
| `assetTag`                 | `prefix`, `eq`                                                           |
| `staleDays`                | `eq`, `lt`, `lte`, `gt`, `gte` (default `gte`)                           |
| `health`                   | `eq` (`healthy`, `attention`, `missing`, `critical`, `unknown`, `stale`) |
| `userEmail`                | `contains`, `eq`, `ne`, `prefix`                                        |
| `userDomain`               | `contains`, `eq`, `ne`, `prefix` (the part after `@`)                    |
| `userName`                 | `contains`, `eq`, `ne`, `prefix`                                        |
| `userExternalId`           | `contains`, `eq`, `ne`, `prefix`                                        |
| `userSource`               | `eq`, `ne` (`entra`, `scim`, `manual`)                                  |

Missing device values never match.

### Conditions on linked people

`user*` conditions read the directory users linked to a device through
`device_user` (not the person who happens to be logged in). They are available in the
dynamic-group rule builder but not in device-table filters, which have no user data.

- **Any linked user** satisfies a positive condition (`eq`, `contains`, `prefix`).
  Two user conditions in `all` do not have to describe the same person.
- `is not` (`ne`) means **no linked user** matches. A device with no linked users
  therefore satisfies `is not`, and fails every positive condition.
- `none` is the clearest way to say "no linked contractor": put the positive
  condition in `none`.
- Disabled (leaver) users are ignored. People excluded from the group are also ignored
  for that group's evaluation, so a rule cannot pull a device in through a person the
  group excludes.
- `userSource` is the identity source recorded on the directory user: `entra`
  (Microsoft Entra ID / Graph import), `scim` (generic SCIM directory) or `manual`.

### Recompute

Dynamic membership is recomputed:

- When a group is created or updated.
- When a device is created, updated or reports inventory.
- During daily maintenance (full tenant pass).
- On demand with `POST /groups/sync`.

Only `source = 'dynamic'` rows are replaced. Manual rows survive as explicit exceptions.
Device assign/unassign is rejected for dynamic groups. Switching a group to manual drops
dynamic rows and keeps manual rows.

### Preview

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$GROUP_ID/preview" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Preview uses the saved rules. Save first, then preview.

## Nested groups

A group can contain other device groups. Membership is the transitive union of the
group's own members and every child group's members, including children of children.

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$PARENT_ID/members" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "assign": { "childGroups": ["child_group_id"] } }'
```

Inherited devices are materialised into `group_device` with `source = 'nested'`, so
policy, script and scope resolution keep reading one membership table. A device that is
already a manual, dynamic or directory member of the parent stays with that stronger
source; inheritance never overwrites it. A device inherited through two children is
counted once, and a policy assigned to both parent and child still resolves once per
device.

Removing a child edge immediately drops the devices only that child contributed.
Nesting is rejected when it would create a cycle (including a longer path) or a chain
deeper than eight groups. Corrupt cyclic rows read back as a bounded traversal rather
than a loop or a stack overflow.

The group page lists child groups, shows each inherited device with the child group that
brought it in, and lets an administrator add or remove children in edit mode.

## Exclusions

An operator can explicitly exclude a device or a directory person from a group.
Exclusions always win over manual membership, rule matches, directory-derived membership
and inherited membership.

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$GROUP_ID/members" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "exclude": { "devices": ["device_id"], "users": ["directory_user_id"] },
    "unexclude": { "devices": [], "users": [] }
  }'
```

**Device exclusions** remove every membership row for the device in that group and the
device is skipped by later recomputes. Assigning an excluded device is rejected until
the exclusion is removed. Other groups and direct device policy assignments are
unaffected.

**Person exclusions** are narrower, deliberately:

- The person's Apple user channel stops receiving this group's user-scoped
  configurations.
- When the group follows a directory group, that person no longer contributes devices
  through it.
- That person is ignored when this group's `user*` rules are evaluated.
- A device that is also a member through another person, a rule, a manual assignment or
  a child group **stays in the group and keeps device-scoped policy**. Excluding a person
  never silently pulls a shared device out of a device policy. Remove the device
  explicitly to take it out of device-scoped delivery.

## Sync devices

Group membership changes do not push by themselves. Wake affected Apple devices:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["group_id"] }'
```

Windows devices poll. Android policies are pushed directly when assignments change.

## Duplicate and delete

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$GROUP_ID/duplicate" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

curl -X DELETE "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["group_id"] }'
```

Bulk delete returns `{ deleted, failed }`.

## Limitations

- Dynamic evaluation is application-side, not indexed. Cost is proportional to the number
  of dynamic groups and devices.
- The dashboard rule editor only edits `all` conditions. Use the API for `any`/`none`.
- Tenant export/import does not carry dynamic rules; an imported dynamic group becomes
  manual.
- Group names are not unique. Prefer ids in automation.

## API endpoints

| Method             | Path                                             | Purpose                |
| ------------------ | ------------------------------------------------ | ---------------------- |
| `GET/POST`         | `/api/v1/tenants/:tenantId/groups`               | List / create          |
| `GET/PATCH/DELETE` | `/api/v1/tenants/:tenantId/groups/:id`           | Read / update / delete |
| `GET`              | `/api/v1/tenants/:tenantId/groups/:id/preview`   | Dynamic preview        |
| `PATCH`            | `/api/v1/tenants/:tenantId/groups/:id/members`   | Assign/unassign        |
| `POST`             | `/api/v1/tenants/:tenantId/groups/sync`          | Wake affected devices  |
| `POST`             | `/api/v1/tenants/:tenantId/groups/:id/duplicate` | Duplicate              |

## Next

- [Policies](/manage/policies)
- [Applications](/manage/applications)
