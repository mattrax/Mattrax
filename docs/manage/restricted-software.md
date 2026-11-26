# Restricted software

Restricted software is a tenant-scoped deny list for applications. It is separate from
the application catalogue and from configuration policies: the catalogue says what
Mattrax may install, a restricted-software rule says what must not be installed or run.
A title can be in both places; the restricted rule wins.

This is not an allow list. An allow list would permit only named applications and deny
everything else. A restricted-software rule matches one identifier and leaves every other
application alone.

## Model

Each record stores:

| Field                | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `name`               | Operator-facing label.                                                                                        |
| `platform`           | `apple` (macOS), `win` or `android`.                                                                          |
| `matchType`          | `bundle-id`, `process-name`, `msi-product-code` or `android-package`.                                         |
| `matchValue`         | The identifier to compare.                                                                                    |
| `action`             | `block-install`, `kill-process` or `delete-app`.                                                              |
| `message`            | Operator note. Included in notifications and descriptions; the macOS agent does not display it on the device. |
| `notificationEmails` | Optional recipients for the violation email, up to 10.                                                        |
| `enabled`            | Disabled rules keep their scope but contribute nothing.                                                       |
| scope                | Device and group assignments, each `include` or `exclude`.                                                    |

The identifier must make sense on its platform:

| Platform | Accepted identifiers               |
| -------- | ---------------------------------- |
| macOS    | `bundle-id`, `process-name`        |
| Windows  | `msi-product-code`, `process-name` |
| Android  | `android-package`                  |

A rule stores a normalised `matchKey` (trimmed, lower-cased). Two rules for the same
identifier on the same platform are rejected, so an administrator cannot create
overlapping records that disagree about the action.

Scope follows policy semantics:

- a direct device exclude is final;
- a direct device include wins over a group exclude;
- a group include applies unless a group exclude vetoes it.

## Detection

Every full inventory report is matched against the rules that resolve to the device:

- Apple: the daily or manual `InstalledApplicationList` response.
- Android: each status notification carrying `applicationReports`.
- Windows: the daily `Win32AppInventory` report.

A match creates a **violation** on the device timeline and on the fleet **Restricted
software → Violations** view. The violation row is unique per `(rule, device)`, so a
repeated inventory report only updates `lastDetectedAt` and the occurrence count. That is
the de-duplication boundary: one audit entry and one webhook event per episode, not one
per day. When the application disappears the violation is marked **resolved**; if it
returns later the same row is reopened and a new event is emitted.

Process-name matching is deliberately conservative in detection: it compares the
inventory display name or the last bundle-id segment because inventory does not report an
executable name. The macOS agent uses the real process table when it enforces.

## Enforcement matrix

| Platform | Action          | Enforcement                                                                                                                                                                                                                                                                                                                            |
| -------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android  | `block-install` | **Enforced after delivery.** The package is compiled into the Managed Google Play policy with `installType: BLOCKED` for every in-scope device, appended last so it wins over a `FORCE_INSTALLED` fragment. The violation stays **Pending** until a policy push succeeds; with no active Android enterprise it never becomes enforced. |
| Android  | `kill-process`  | **Detection only.** The Android Management API has no process-kill command.                                                                                                                                                                                                                                                            |
| Android  | `delete-app`    | **Detection only.** The policy can block installation but has no remote uninstall-arbitrary-package command.                                                                                                                                                                                                                           |
| macOS    | `kill-process`  | **Enforced by mattraxd.** The agent reads a `com.mattrax.restricted-software` profile, terminates matching processes on its schedule and posts the result.                                                                                                                                                                             |
| macOS    | `delete-app`    | **Enforced by mattraxd.** The agent terminates matching processes and removes the app bundle.                                                                                                                                                                                                                                          |
| macOS    | `block-install` | **Detection only.** macOS has no pre-install hook; Mattrax cannot prevent the install. Use kill or delete to act afterwards.                                                                                                                                                                                                           |
| Windows  | any             | **Detection only.** No Windows agent is deployed for this feature, and OMA-DM cannot kill a process or remove an installed application. The UI says so explicitly.                                                                                                                                                                     |

The dashboard repeats the platform/action capability in the rule editor and labels each
violation **Enforced**, **Pending**, **Failed** or **Detection only**. It never presents a
detection-only action as enforcement.

## macOS agent requirements

`mattraxd` 1.1 or newer must be installed on the Mac. The server delivers one
configuration profile per rule with payload type `com.mattrax.restricted-software`. The
payload contains the rule id, match type/value, action, interval and the signed device
token; the profile is installed only for rules whose capability is `agent`.

Apple rules also match inventory on iPhone and iPad. Those devices have no
mattraxd agent, so the violation is recorded as **Detection only** there.

The agent:

1. reads installed profiles on each 30-second daemon tick;
2. enforces a rule when its digest changed or its interval elapsed (default 300 seconds);
3. finds running processes with `ps`, signals them with SIGTERM and then SIGKILL after a
   short grace period;
4. locates bundles by reading `CFBundleIdentifier` from `Contents/Info.plist` under
   `/Applications`, `/System/Applications` and user `Applications` directories;
5. filters protected targets before sending any signal: Apple system identifiers
   (`com.apple.*`), bundles under `/System`, symlinked app entries, PID 1, the
   agent itself and a fixed list of system process names are never terminated;
6. re-validates a bundle immediately before deletion: it must still be a real
   `.app` directory (not a symlink), under `/Applications` or a user
   `Applications` directory, and its `CFBundleIdentifier` must still equal the
   rule value. A symlink swapped in after the scan is rejected;
7. checks every signal result, re-checks after SIGKILL and reports a failure when
   a process remains; an EPERM is not treated as "process gone";
8. posts one result to `POST /api/v1/restricted-software-agent/results` when it acted or
   failed. A no-op pass is not posted, which keeps the audit stream meaningful. The
   server rejects an agent result for a detection-only rule or a non-macOS device.

The result updates the violation's enforcement state and writes a
`restricted_software.enforced` or `restricted_software.enforcement_failed` audit entry.

## API

```
GET    /api/v1/tenants/:tenantId/restricted-software
POST   /api/v1/tenants/:tenantId/restricted-software
GET    /api/v1/tenants/:tenantId/restricted-software/:id
PATCH  /api/v1/tenants/:tenantId/restricted-software/:id
DELETE /api/v1/tenants/:tenantId/restricted-software/:id
PATCH  /api/v1/tenants/:tenantId/restricted-software/:id/assignments
GET    /api/v1/tenants/:tenantId/restricted-software-violations
GET    /api/v1/tenants/:tenantId/devices/:id/restricted-software
POST   /api/v1/restricted-software-agent/results
```

Configuration reads require `restricted_software.read`; writes require
`restricted_software.write` and a recent step-up (`restricted-software-change`).

## Notifications and audit

- **Webhook**: `restricted_software.violation`, delivered with the normal
  `X-Mattrax-Signature`, `X-Mattrax-Timestamp` and `X-Mattrax-Delivery` headers. The
  payload carries the rule, device, matched identifier, enforcement state and occurrence
  count. It is signed with the tenant's endpoint secret like every other event.
- **Email**: optional. When a rule lists recipients, the same event is rendered as a short
  message and queued in the transactional outbox. It is off by default.
- **Audit**: every create, edit, delete, scope change, violation detection,
  violation resolution and enforcement result is written to the tenant audit log. Device
  actions also appear on the device timeline.

The notification sweep runs hourly. It marks a violation notified only after the webhook
and email attempts, so a crashed sweep retries rather than losing the event.

## Limits

| Limit                   | Value                |
| ----------------------- | -------------------- |
| Rules per tenant        | 100                  |
| Scope targets per rule  | 500                  |
| Notification recipients | 10 per rule          |
| Name length             | 120 characters       |
| Match value length      | 255 characters       |
| Operator note length    | 2,000 characters     |
| Fleet violation list    | 500 rows per request |

Violations are retained with the device and rule; deleting a rule cascades its
violations. The fleet view is a read model over the violation table, not a separate
history log.

## Operational notes

- Creating or editing a rule re-evaluates the current inventory immediately and pushes the
  affected Apple devices and Android policies; a new rule with no scope has no effect.
- Android policy delivery requires the tenant's Android enterprise to be active. If it is
  not, the rule is stored and detection still runs, but no policy is sent.
- A macOS device must have checked in at least once since the rule was scoped to receive
  the profile. The agent then enforces on its own timer, independent of check-in cadence.
- Profile removal is durable: the server reads the device's profile-command history
  without the 200-command window used elsewhere, and removes a profile even when
  `AUTH_SECRET` is unavailable. Token issuance is only needed to install.
- Dangerous process rules are refused: PID 1, mattraxd and a fixed system-process list
  cannot be targeted for kill or delete. Delete app requires a bundle identifier.
- Windows matching uses the MSI ProductCode that Windows reports as the inventory
  identifier; a process name can be matched for detection but cannot be enforced.
