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

Missing device values never match.

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
