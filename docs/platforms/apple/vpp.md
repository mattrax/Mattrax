# Apps & Books (VPP)

Apple Business Manager Apps & Books provides volume licences for apps and books. Mattrax
uses a location token to sync the licence pool and assign device-based licences.

## What you need

- An Apps & Books location token (`.vpptoken`) from Apple Business Manager.
- Devices enrolled in Mattrax with a serial number. Assignments are per device, not per
  Apple ID.
- An APNs certificate, so installed apps can be pushed to devices.

## Upload the token

**Settings → Management → Apps & Books → Connect**, or:

```bash
curl -X PUT "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/vpp/token" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "token": "<base64 .vpptoken content>" }'
```

Mattrax accepts the raw `.vpptoken` content or the base64 sToken, normalises it and
validates it by listing assets. The token is sealed with `AUTH_SECRET`.

## Sync the licence pool

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/vpp/sync" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

Sync pages `GET /v2/assets`, enriches names and bundle ids from the tenant application
catalogue or ABM app metadata, and stores total, available, assigned and retired licences.
Assets that disappear from Apple are zeroed but kept for history.

## Assign and install

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/vpp/assets/$ADAM_ID/install" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "devices": ["device_id"], "groups": ["group_id"] }'
```

The response reports `assigned`, `queued`, `skipped` and `failed`.

For each eligible Apple device, Mattrax:

1. Checks the asset is device-assignable and has an available licence.
2. Associates the licence by serial.
3. Records `device_vpp_assignment` with state `assigned`.
4. Decrements the local pool.
5. Queues `InstallApplication` with `PurchaseMethod: 1` and pushes the device.

The install is not marked successful until the device reports the app in its inventory.

## Release a licence

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/vpp/assets/$ADAM_ID/release" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "devices": ["device_id"] }'
```

Release requires a revocable asset and an active assignment. It disassociates the licence,
marks the assignment `revoked` and returns the seat to the pool. It does **not** queue an
uninstall command.

## Where VPP fits with the app catalogue

- **VPP** — licensed App Store apps, assigned by device serial, installed from the licence
  pool.
- **Application catalogue** — metadata for manifest, store or uploaded apps. A store entry
  can be installed with an iTunes Store id; a manifest entry needs a manifest URL.
- **Direct action** — `POST /devices/:id/action` with `install-app` and a `manifestUrl` or
  `iTunesStoreId`.

If a VPP token exists but is inactive or has no pool, Mattrax fails closed instead of
falling back to a user-account App Store install.

## Limitations

- Only **device-based** licensing is implemented. User-based VPP (`clientUserId`) is not.
- There is no automatic VPP sync or event-status polling. Run sync after purchasing
  licences.
- Release does not uninstall the app.
- Apps without a serial (for example Android devices) cannot receive a VPP licence.
- VPP sync and install require a valid APNs certificate for push delivery.

## API endpoints

| Method   | Path                                                   | Purpose                 |
| -------- | ------------------------------------------------------ | ----------------------- |
| `GET`    | `/api/v1/tenants/:tenantId/vpp`                        | Token status and org    |
| `PUT`    | `/api/v1/tenants/:tenantId/vpp/token`                  | Upload a location token |
| `DELETE` | `/api/v1/tenants/:tenantId/vpp/token`                  | Remove the token        |
| `POST`   | `/api/v1/tenants/:tenantId/vpp/sync`                   | Sync assets             |
| `GET`    | `/api/v1/tenants/:tenantId/vpp/assets`                 | Licence pools           |
| `GET`    | `/api/v1/tenants/:tenantId/vpp/assignments`            | Device assignments      |
| `POST`   | `/api/v1/tenants/:tenantId/vpp/assets/:adamId/install` | Assign and install      |
| `POST`   | `/api/v1/tenants/:tenantId/vpp/assets/:adamId/release` | Release a licence       |

## Troubleshooting

| Symptom                        | Check                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| Upload rejected                | Token is a location token, not a legacy VPP token; it has not expired   |
| Install fails closed           | Asset is not device-assignable, pool is empty, or the token is inactive |
| No devices eligible            | Only enrolled Apple devices with a serial are eligible                  |
| App installed but no inventory | Run **Refresh applications** on the device                              |
| Release rejected               | Asset is not revocable or the assignment is already revoked             |

## Next

- [Applications](/manage/applications)
- [Apple security and inventory](/platforms/apple/security)
