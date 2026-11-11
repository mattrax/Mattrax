# FileVault, inventory and health

Mattrax collects Apple security state through DDM status items and two MDM commands:
`SecurityInfo` and `InstalledApplicationList`.

## FileVault recovery-key escrow

### Collect

Queue a security-info command:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/action" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "collect-security-info" }'
```

Mattrax parses `PersonalRecoveryKey`, `FDE_RecoveryKey` or `FDE_PersonalRecoveryKeyCMS`,
plus `FDE_Enabled`/`FileVaultStatus` and `BootstrapTokenEscrowed`. The recovery key and
bootstrap token are sealed with `AUTH_SECRET` in `device_secret`.

The device detail page shows **presence only**: whether a key is escrowed, when it was
updated and when it was rotated.

### Reveal

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/recovery-key" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "x-mattrax-step-up: $STEP_UP_GRANT"
```

Reveal requires the `write` role (owner or admin) and the `recovery-key-reveal` step-up
action. The response is audited as `device.recovery_key_viewed`.

:::warning CMS-wrapped keys
A personal recovery key wrapped with the FileVault escrow certificate is returned as the
raw escrowed payload. Decrypting it is an operator step with the escrow certificate.
:::

### Bootstrap token

The bootstrap token is escrowed the same way. `device_apple.bootstrap_token` is retained
only for legacy plaintext rows and is cleared on new writes. Device detail exposes
`bootstrapTokenEscrowed` and `bootstrapTokenUpdatedAt`.

## Inventory

### DDM status items

These update automatically on each declaration status report:

- Serial number, model, model identifier, model number
- OS marketing name, version and build
- FileVault enabled
- Battery health
- Disk total and used
- Client capabilities
- Declaration state

### Installed applications

Queue a refresh:

```bash
curl -X POST "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/devices/$DEVICE_ID/action" \
  -H "Authorization: Bearer $MATTRAX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "action": "refresh-applications" }'
```

The result replaces the device's `device_application` rows. An empty list clears them.
Fields: bundle id, name, version, short version, bundle size, dynamic size, update
availability, managed flag and last-reported time.

Tenant-wide inventory:

```bash
curl "$MATTRAX_URL/api/v1/tenants/$TENANT_ID/applications/inventory?q=chrome&managed=managed&updates=available" \
  -H "Authorization: Bearer $MATTRAX_TOKEN"
```

### Inventory fields on a device

| Field                                               | Source                      |
| --------------------------------------------------- | --------------------------- |
| `serial`, `model`, `modelIdentifier`, `modelNumber` | DDM status                  |
| `osVersion`, `osBuild`, `osEdition`                 | DDM status                  |
| `diskTotal`, `diskUsed`                             | DDM status                  |
| `fileVaultEnabled`                                  | DDM status / `SecurityInfo` |
| `batteryHealth`                                     | DDM status                  |
| `capabilities`                                      | DDM status                  |
| `lastSeenAt`                                        | Check-in                    |
| `inventoryUpdatedAt`                                | Last inventory write        |
| `applicationsUpdatedAt`                             | Last app inventory write    |

## Device health

Health is a derived rollup, not a compliance engine. It evaluates:

| Reason                               | Level    |
| ------------------------------------ | -------- |
| `unenrolled`                         | Critical |
| `unenrolling` / `enrolling`          | Warning  |
| Never seen                           | Warning  |
| Stale (default 7 days)               | Warning  |
| Invalid or inactive DDM declarations | Warning  |
| Disk ≥ 90%                           | Warning  |
| Disk ≥ 97%                           | Critical |
| FileVault disabled on macOS          | Warning  |
| Battery service/replace/poor         | Warning  |

Levels are `healthy`, `attention`, `critical` and `unknown`. A level change writes an
audit event and emits `device.compliance_changed`.

Endpoints:

```text
GET /api/v1/tenants/:tenantId/device-health
GET /api/v1/tenants/:tenantId/devices/:id/health
```

Credential health is separate:

```text
GET /api/v1/tenants/:tenantId/credential-health
GET /api/v1/tenants/:tenantId/push-health
```

Credential health summarizes APNs and SCEP CA expiry. Push health summarizes delivery
failures and invalid tokens.

## Command matrix

| Action                  | Requires step-up | Notes                           |
| ----------------------- | ---------------- | ------------------------------- |
| `sync`                  | No               | APNs wake-up                    |
| `collect-security-info` | No               | FileVault/bootstrap token       |
| `refresh-applications`  | No               | Installed app inventory         |
| `lock`                  | Yes              | Returns a PIN                   |
| `wipe`                  | Yes              | Erase with PIN                  |
| `restart`               | Yes              | —                               |
| `shutdown`              | Yes              | —                               |
| `clear-passcode`        | Yes              | Needs an unlock token           |
| `install-app`           | Yes              | Manifest URL or iTunes Store id |

## Limitations

- FileVault and installed-app inventory are fixture-tested, not validated on real
  supervised hardware in this repository.
- There is no bulk recovery-key export and no key-rotation workflow beyond re-reporting.
- There is no automatic app inventory refresh schedule.
- There is no Windows or Android installed-app inventory.
- Compliance is derived health only. There is no policy engine, baseline or remediation.

## Next

- [Manage devices](/manage/devices)
- [Security](/manage/security)
