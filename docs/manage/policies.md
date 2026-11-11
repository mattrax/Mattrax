# Policies

A policy is a named container with a priority and one or more configurations. Assignments
decide which devices receive it; resolution decides which configuration wins when several
policies apply.

## Create a policy

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Baseline",
    "notes": "Company defaults",
    "priority": 100,
    "configurations": {
      "mttx.apple.device": { "camera": false }
    }
  }'
```

Patching a configuration with `null` deletes that kind. Every configuration is validated
before any write.

## Configuration kinds

| Kind                          | Platform | Payload                                              |
| ----------------------------- | -------- | ---------------------------------------------------- |
| `mttx.apple.device`           | Apple    | Built-in settings; currently `{ "camera": boolean }` |
| `mttx.apple.custom.<id>`      | Apple    | Base64 `.mobileconfig`                               |
| `mttx.apple.certificate.<id>` | Apple    | PEM certificate for DDM                              |
| `mttx.apple.declaration.<id>` | Apple    | Raw DDM declaration                                  |
| `mttx.windows.custom.<id>`    | Windows  | OMA-URI node or `{ nodes: [...] }`                   |
| `mttx.android.policy.<id>`    | Android  | AMAPI policy fragment                                |

`mttx.apple.application.<id>` is rejected. See [Apple DDM](/platforms/apple/ddm),
[Windows policies](/platforms/windows/policies) and
[Android policies](/platforms/android/policies).

## The designer

The dashboard policy designer and the public `/designer` page read the same catalogue:

- Apple and Android from one file each.
- Windows split into a browse index, per-collection files and a search index.

Selections are stored as `mttx.apple.custom.designer` or
`mttx.apple.declaration.d<hash>`. The designer is optional; you can upload a profile or
write a declaration directly.

See [Policy catalogue](/reference/policy-catalogue) for file sizes and regeneration.

## Assign

### To a group

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/groups/$GROUP_ID/members" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assign": { "policies": [{ "id": "policy_id", "mode": "include" }] },
    "unassign": { "policies": [] }
  }'
```

### To a device

```bash
curl -X PATCH "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/assignments" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assign": [{ "id": "device_id", "mode": "include" }],
    "unassign": []
  }'
```

## Precedence

Resolution is evaluated per policy:

1. Direct device **exclude** removes it entirely.
2. Direct device **include** beats group includes and excludes.
3. Group **exclude** vetoes group delivery. A direct include can still add it.
4. Highest `priority` wins. Ties: newest `updatedAt`, then ascending policy id.

Inspect the trace:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/effective-policy" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Sync

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["policy_id"] }'
```

Apple devices receive an APNs wake-up. Windows waits for polling. Android pushes the
policy directly.

## Deployment history

Every save creates a snapshot:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/deployments" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Roll back:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/deployments/$DEPLOYMENT_ID/rollback" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

## Preview a mobileconfig

Upload a profile and inspect the parsed payloads before creating a policy:

```bash
curl -X POST "$MATTRAX_URL/api/v1/policy/preview-mobileconfig" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "content": "<base64>" }'
```

## Duplicate and delete

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies/$POLICY_ID/duplicate" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"

curl -X DELETE "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/policies" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["policy_id"] }'
```

## Application payloads

Policies can store application files in R2:

```text
POST /api/v1/tenants/:tenantId/policies/:id/applications
GET  /api/v1/tenants/:tenantId/policies/:id/applications/:sha256
```

The download returns JSON with base64 `content`, not binary bytes. Uploaded policy
applications are not automatically deployed as Apple apps; see
[Applications](/manage/applications).

## Limitations

- The built-in Apple device configuration is limited to the camera restriction.
- `mttx.apple.application.<id>` is rejected.
- Policy resolution is application-side; very large fleets may see slower syncs.
- Windows only supports OMA-URI `Replace`.
- Android merge rules concatenate arrays; plan fragments accordingly.

## Next

- [Groups](/manage/groups)
- [Applications](/manage/applications)
- [Apple DDM](/platforms/apple/ddm)
