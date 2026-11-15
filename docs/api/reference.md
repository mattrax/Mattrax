# API reference

All paths are relative to `/api/v1` unless noted. Authentication and conventions are in
[REST API](/api/).

## Account and identity

| Method   | Path                                | Purpose                                           |
| -------- | ----------------------------------- | ------------------------------------------------- |
| `POST`   | `/account/email-verification`       | Send a verification email                         |
| `POST`   | `/verify-email`                     | Consume a verification token                      |
| `POST`   | `/account/email-change`             | Start a change (step-up; notifies both addresses) |
| `POST`   | `/account/email-change/verify`      | Consume the confirmation token (409 if taken)     |
| `POST`   | `/account/email-change/cancel`      | Consume the cancellation token                    |
| `GET`    | `/account/api-tokens`               | List the caller's tokens                          |
| `POST`   | `/account/api-tokens`               | Create a token (step-up)                          |
| `DELETE` | `/account/api-tokens/:tokenId`      | Revoke a token (step-up)                          |
| `GET`    | `/account/step-up`                  | Available step-up factors                         |
| `POST`   | `/account/step-up/totp`             | TOTP step-up grant                                |
| `POST`   | `/account/step-up/passkey/begin`    | Begin passkey step-up                             |
| `POST`   | `/account/step-up/passkey/complete` | Complete passkey step-up                          |
| `DELETE` | `/account/passkeys/:credentialId`   | Remove a passkey (step-up)                        |
| `GET`    | `/account/sessions`                 | List sessions with device and last use            |
| `DELETE` | `/account/sessions/:sessionId`      | Revoke a session                                  |
| `POST`   | `/account/sessions/revoke-all`      | Sign out everywhere (step-up)                     |
| `GET`    | `/account/audit/search`             | Account activity, cursor paginated                |
| `GET`    | `/account/audit/export`             | Account activity as CSV or JSON                   |
| `POST`   | `/account/recovery`                 | Send a break-glass proof link                     |
| `POST`   | `/account/recovery/verify`          | Consume the proof link                            |
| `GET`    | `/me`                               | Current user and tenants                          |
| `PATCH`  | `/me`                               | Update name or image                              |
| `DELETE` | `/me`                               | Delete the account                                |
| `GET`    | `/tenants`                          | Tenants the user belongs to                       |
| `POST`   | `/tenants`                          | Create a tenant                                   |
| `GET`    | `/tenants/:tenantId`                | Tenant detail and branding                        |
| `PATCH`  | `/tenants/:tenantId`                | Update name, slug, branding, metadata             |
| `DELETE` | `/tenants/:tenantId`                | Full teardown (owner + step-up)                   |

### Auth actions

`/api/v1/<action>`:

`ssoSignIn`, `recoverySignIn`, `beginPasskeyRegistration`, `completePasskeyRegistration`,
`beginTotpEnrollment`, `confirmTotpEnrollment`, `disableTotp`,
`regenerateTotpRecoveryCodes`, `verifyTotpPending`, `recoverTotpPending`,
`beginPasskeySignIn`, `completePasskeySignIn`, `beginPasskeyPending`,
`completePasskeyPending`, `beginPasskeyStepUp`, `completePasskeyStepUp`,
`beginPasskeyEnrollment`, `completePasskeyEnrollment`, `listPasskeys`, `renamePasskey`.

Session helpers: `POST /getSession`, `/requireSession`, `/signOut`, `/renewSession`.
Responses use `{ _tag: "Success", value }`, `{ _tag: "Failure", error }` or
`{ _tag: "PendingAuthentication" }`.

## Tenants, export and backups

| Method   | Path                                      | Purpose                                     |
| -------- | ----------------------------------------- | ------------------------------------------- |
| `GET`    | `/tenants/:tenantId/export`               | Versioned JSON bundle; `?includeAudit=true` |
| `POST`   | `/tenants/import`                         | Import a bundle as a new tenant             |
| `POST`   | `/tenants/:tenantId/backups`              | Run a backup now                            |
| `GET`    | `/tenants/:tenantId/backups`              | List backup runs                            |
| `GET`    | `/tenants/:tenantId/backups/:id/download` | Download a bundle (step-up)                 |
| `POST`   | `/tenants/:tenantId/backups/:id/pin`      | Keep a run past retention (step-up)         |
| `POST`   | `/tenants/:tenantId/backups/:id/unpin`    | Return a run to retention (step-up)         |
| `DELETE` | `/tenants/:tenantId/backups/:id`          | Delete a run and its object (step-up)       |
| `POST`   | `/tenants/:tenantId/backups/:id/restore`  | Restore in place (step-up, slug confirm)    |

## SSO, directory and SCIM tokens

| Method      | Path                                          | Purpose                              |
| ----------- | --------------------------------------------- | ------------------------------------ |
| `GET/PATCH` | `/tenants/:tenantId/sso`                      | SSO configuration (step-up on write) |
| `GET/PATCH` | `/tenants/:tenantId/identity/directory`       | Entra sync status and cadence        |
| `POST`      | `/tenants/:tenantId/identity/directory/sync`  | Run a sync now                       |
| `GET`       | `/tenants/:tenantId/identity/domains`         | Verified domains                     |
| `POST`      | `/tenants/:tenantId/identity/domains/refresh` | Refresh from Graph                   |
| `GET/POST`  | `/tenants/:tenantId/scim-tokens`              | List/create SCIM tokens              |
| `DELETE`    | `/tenants/:tenantId/scim-tokens/:tokenId`     | Revoke                               |

## Members and invitations

| Method   | Path                                           | Purpose              |
| -------- | ---------------------------------------------- | -------------------- |
| `GET`    | `/tenants/:tenantId/users`                     | Members              |
| `POST`   | `/tenants/:tenantId/invitations`               | Invite a member      |
| `GET`    | `/tenants/:tenantId/invitations`               | Pending invitations  |
| `DELETE` | `/tenants/:tenantId/invitations/:invitationId` | Cancel an invitation |
| `POST`   | `/invitations/accept`                          | Accept an invitation |
| `PATCH`  | `/tenants/:tenantId/users/:memberId`           | Change a role        |
| `DELETE` | `/tenants/:tenantId/users/:memberId`           | Remove a member      |

## Enrollment

| Method  | Path                                      | Purpose                                      |
| ------- | ----------------------------------------- | -------------------------------------------- |
| `GET`   | `/enrollment/:id`                         | Public enrollment data; `code?`, `platform?` |
| `GET`   | `/enrollment/:id/apple.mobileconfig`      | Signed Apple profile                         |
| `GET`   | `/abm/ade/:token`                         | ADE profile from a signed token              |
| `GET`   | `/tenants/:tenantId/enrollment`           | Settings and Windows discovery URL           |
| `GET`   | `/tenants/:tenantId/enrollment/attempts`  | Diagnostic attempts                          |
| `PATCH` | `/tenants/:tenantId/enrollment`           | Toggle platforms, code, cap                  |
| `POST`  | `/tenants/:tenantId/enrollment/reset`     | Replace the enrollment id                    |
| `GET`   | `/tenants/:tenantId/identity/scep`        | Tenant CA metadata and SCEP URL              |
| `PUT`   | `/tenants/:tenantId/identity/scep`        | Import a tenant CA                           |
| `POST`  | `/tenants/:tenantId/identity/scep/rotate` | Rotate the tenant CA                         |

## Apple push

| Method | Path                          | Purpose                  |
| ------ | ----------------------------- | ------------------------ |
| `GET`  | `/tenants/:tenantId/apns`     | APNs status              |
| `GET`  | `/tenants/:tenantId/apns/csr` | CSR plist                |
| `POST` | `/tenants/:tenantId/apns`     | Upload `{ email, cert }` |

## Apple Business Manager

| Method   | Path                                                 | Purpose                          |
| -------- | ---------------------------------------------------- | -------------------------------- |
| `GET`    | `/tenants/:tenantId/abm`                             | Credential and org state         |
| `PUT`    | `/tenants/:tenantId/abm/token`                       | Upload a Business API credential |
| `DELETE` | `/tenants/:tenantId/abm/token`                       | Remove the credential            |
| `POST`   | `/tenants/:tenantId/abm/sync`                        | Sync devices                     |
| `GET`    | `/tenants/:tenantId/abm/devices`                     | List devices                     |
| `GET`    | `/tenants/:tenantId/abm/devices/:serial`             | Device detail                    |
| `POST`   | `/tenants/:tenantId/abm/devices/:serial/assign`      | Assign to the MDM server         |
| `GET`    | `/tenants/:tenantId/abm/devices/:serial/profile-url` | Signed ADE URL                   |

## Apps & Books

| Method   | Path                                            | Purpose                 |
| -------- | ----------------------------------------------- | ----------------------- |
| `GET`    | `/tenants/:tenantId/vpp`                        | Token and org state     |
| `PUT`    | `/tenants/:tenantId/vpp/token`                  | Upload a location token |
| `DELETE` | `/tenants/:tenantId/vpp/token`                  | Remove the token        |
| `POST`   | `/tenants/:tenantId/vpp/sync`                   | Sync assets             |
| `GET`    | `/tenants/:tenantId/vpp/assets`                 | Licence pools           |
| `GET`    | `/tenants/:tenantId/vpp/assignments`            | Device assignments      |
| `POST`   | `/tenants/:tenantId/vpp/assets/:adamId/install` | Assign and install      |
| `POST`   | `/tenants/:tenantId/vpp/assets/:adamId/release` | Release a licence       |

## Android

| Method      | Path                                | Purpose                               |
| ----------- | ----------------------------------- | ------------------------------------- |
| `GET/PATCH` | `/tenants/:tenantId/android`        | Status and enablement                 |
| `POST`      | `/tenants/:tenantId/android/signup` | Create a signup URL                   |
| `POST`      | `/tenants/:tenantId/android/sync`   | Push policies                         |
| `GET`       | `/api/v1/android/signup/callback`   | Google callback (absolute path)       |
| `POST`      | `/api/v1/android/pubsub`            | Pub/Sub push endpoint (absolute path) |

## Autopilot

| Method     | Path                                                      | Purpose                  |
| ---------- | --------------------------------------------------------- | ------------------------ |
| `GET`      | `/tenants/:tenantId/autopilot`                            | Settings and Graph state |
| `GET`      | `/tenants/:tenantId/autopilot/devices`                    | Cached devices           |
| `POST`     | `/tenants/:tenantId/autopilot/import`                     | Import hardware hashes   |
| `POST`     | `/tenants/:tenantId/autopilot/sync`                       | Sync from Graph          |
| `DELETE`   | `/tenants/:tenantId/autopilot/devices/:serial`            | Delete an identity       |
| `GET/POST` | `/tenants/:tenantId/autopilot/profiles`                   | List/create profiles     |
| `PATCH`    | `/tenants/:tenantId/autopilot/profiles/:profileId`        | Update a profile         |
| `POST`     | `/tenants/:tenantId/autopilot/profiles/:profileId/assign` | Assign a group           |

## Devices

| Method   | Path                                              | Purpose                          |
| -------- | ------------------------------------------------- | -------------------------------- |
| `GET`    | `/tenants/:tenantId/search`                       | Mixed device/group/policy search |
| `GET`    | `/tenants/:tenantId/devices`                      | All devices (unpaginated)        |
| `GET`    | `/tenants/:tenantId/devices/search`               | Filtered, paginated search       |
| `GET`    | `/tenants/:tenantId/devices/export`               | CSV export                       |
| `GET`    | `/tenants/:tenantId/devices/:id`                  | Device detail                    |
| `PATCH`  | `/tenants/:tenantId/devices/:id`                  | Name, notes, asset tag           |
| `DELETE` | `/tenants/:tenantId/devices`                      | Bulk delete (`ids`)              |
| `GET`    | `/tenants/:tenantId/devices/:id/applications`     | Installed apps                   |
| `GET`    | `/tenants/:tenantId/devices/:id/recovery-key`     | FileVault key (step-up)          |
| `GET`    | `/tenants/:tenantId/devices/:id/effective-policy` | Resolution trace                 |
| `POST`   | `/tenants/:tenantId/devices/:id/action`           | Queue a command                  |
| `GET`    | `/tenants/:tenantId/devices/:id/commands`         | Command history                  |
| `GET`    | `/tenants/:tenantId/devices/:id/declarations`     | DDM declaration state            |
| `POST`   | `/tenants/:tenantId/devices/:id/unenroll`         | Unenroll (Apple)                 |
| `GET`    | `/tenants/:tenantId/devices/:id/health`           | Health and reasons               |
| `GET`    | `/tenants/:tenantId/devices/:id/activity`         | Activity feed                    |
| `POST`   | `/tenants/:tenantId/devices/:id/revoke-identity`  | Revoke certificates              |
| `GET`    | `/tenants/:tenantId/device-health`                | Fleet health counts              |
| `GET`    | `/tenants/:tenantId/push-health`                  | APNs rollup                      |
| `GET`    | `/tenants/:tenantId/credential-health`            | APNs/SCEP expiry                 |

### Device search query

`q`, `status`, `proto`, `groupId`, `notSeenSince`, `staleDays`, `health`,
`push=failing|invalid`, `limit`, `offset`, `sort`, `direction`.

### Device actions

`sync`, `lock`, `wipe`, `restart`, `shutdown`, `clear-passcode`, `install-app`,
`collect-security-info`, `refresh-applications`. `install-app` accepts `manifestUrl` or
`iTunesStoreId`.

## Pre-registration

| Method   | Path                                                 | Purpose     |
| -------- | ---------------------------------------------------- | ----------- |
| `GET`    | `/tenants/:tenantId/device-pre-registrations`        | List        |
| `POST`   | `/tenants/:tenantId/device-pre-registrations/import` | Import rows |
| `DELETE` | `/tenants/:tenantId/device-pre-registrations/:id`    | Delete one  |
| `DELETE` | `/tenants/:tenantId/device-pre-registrations`        | Bulk delete |

## Groups

| Method     | Path                                      | Purpose                     |
| ---------- | ----------------------------------------- | --------------------------- |
| `GET/POST` | `/tenants/:tenantId/groups`               | List/create                 |
| `GET`      | `/tenants/:tenantId/groups/:id`           | Group, devices and policies |
| `GET`      | `/tenants/:tenantId/groups/:id/preview`   | Dynamic preview             |
| `PATCH`    | `/tenants/:tenantId/groups/:id`           | Rename or change rules      |
| `DELETE`   | `/tenants/:tenantId/groups`               | Bulk delete                 |
| `PATCH`    | `/tenants/:tenantId/groups/:id/members`   | Assign/unassign             |
| `POST`     | `/tenants/:tenantId/groups/sync`          | Wake affected devices       |
| `POST`     | `/tenants/:tenantId/groups/:id/duplicate` | Duplicate                   |

## Policies

| Method      | Path                                                                 | Purpose                   |
| ----------- | -------------------------------------------------------------------- | ------------------------- |
| `GET/POST`  | `/tenants/:tenantId/policies`                                        | List/create               |
| `GET`       | `/tenants/:tenantId/policies/:id`                                    | Policy and configurations |
| `PATCH`     | `/tenants/:tenantId/policies/:id`                                    | Update configurations     |
| `DELETE`    | `/tenants/:tenantId/policies`                                        | Bulk delete               |
| `GET/PATCH` | `/tenants/:tenantId/policies/:id/assignments`                        | Assignments               |
| `GET`       | `/tenants/:tenantId/policies/:id/deployments`                        | Snapshot history          |
| `POST`      | `/tenants/:tenantId/policies/:id/deployments/:deploymentId/rollback` | Roll back                 |
| `POST`      | `/tenants/:tenantId/policies/sync`                                   | Wake affected devices     |
| `POST`      | `/tenants/:tenantId/policies/:id/duplicate`                          | Duplicate                 |
| `POST`      | `/tenants/:tenantId/policies/:id/applications`                       | Upload a policy file      |
| `GET`       | `/tenants/:tenantId/policies/:id/applications/:sha256`               | Download a policy file    |
| `POST`      | `/policy/preview-mobileconfig`                                       | Parse a `.mobileconfig`   |

## Applications

| Method             | Path                                                   | Purpose              |
| ------------------ | ------------------------------------------------------ | -------------------- |
| `GET/POST`         | `/tenants/:tenantId/applications`                      | List/create          |
| `GET`              | `/tenants/:tenantId/applications/inventory`            | Fleet inventory      |
| `GET/PATCH/DELETE` | `/tenants/:tenantId/applications/:id`                  | Detail/update/delete |
| `PATCH`            | `/tenants/:tenantId/applications/:id/assignments`      | Assign               |
| `POST`             | `/tenants/:tenantId/applications/:id/install`          | Queue install        |
| `POST`             | `/tenants/:tenantId/applications/:id/upload`           | Upload a package     |
| `GET`              | `/tenants/:tenantId/applications/:id/download/:sha256` | Download a package   |

## Audit, webhooks and billing

| Method         | Path                                                   | Purpose                       |
| -------------- | ------------------------------------------------------ | ----------------------------- |
| `GET`          | `/tenants/:tenantId/audit-log`                         | Recent audit entries (legacy) |
| `GET`          | `/tenants/:tenantId/audit/search`                      | Filtered search               |
| `GET`          | `/tenants/:tenantId/audit/export`                      | CSV/JSON export               |
| `GET/POST`     | `/tenants/:tenantId/webhooks`                          | List/create endpoints         |
| `PATCH/DELETE` | `/tenants/:tenantId/webhooks/:webhookId`               | Update/delete                 |
| `POST`         | `/tenants/:tenantId/webhooks/:webhookId/rotate-secret` | Rotate secret                 |
| `POST`         | `/tenants/:tenantId/webhooks/:webhookId/test`          | Send a test event             |
| `GET`          | `/tenants/:tenantId/billing`                           | Billing summary               |
| `POST`         | `/tenants/:tenantId/billing/portal`                    | Stripe portal URL (step-up)   |

## Non-Enterprise routes

| Method | Path                              | Auth             | Purpose                       |
| ------ | --------------------------------- | ---------------- | ----------------------------- |
| `POST` | `/api/v1/billing/webhook`         | Stripe signature | Subscription and invoice sync |
| `GET`  | `/api/v1/sso/azure/start`         | Public           | Begin Entra OIDC              |
| `GET`  | `/api/v1/sso/azure/callback`      | Signed state     | Complete Entra OIDC           |
| `GET`  | `/api/v1/android/signup/callback` | Signed state     | Finish Android signup         |
| `POST` | `/api/v1/android/pubsub`          | Google OIDC      | Android notifications         |
| `*`    | `/scim/v2/:tenantId/...`          | SCIM bearer      | SCIM 2.0                      |
| `GET`  | `/api/platform/status`            | Public           | Platform status               |

## Protocol routes

| Method | Path                                               | Purpose                     |
| ------ | -------------------------------------------------- | --------------------------- |
| `PUT`  | `/mdm/apple/mdm`                                   | Apple check-in and commands |
| `GET`  | `/mdm/apple/scep/:organizationId`                  | SCEP CA caps/cert           |
| `POST` | `/mdm/apple/scep/:organizationId`                  | SCEP PKIOperation           |
| `GET`  | `/mdm/apple/assets/:identifier`                    | DDM asset                   |
| `GET`  | `/mdm/apple/profiles/:deviceToken/:policyId/:kind` | Signed legacy profile       |
| `POST` | `/mdm/windows/discovery`                           | Windows discovery           |
| `POST` | `/mdm/windows/policy`                              | WSTEP policy                |
| `POST` | `/mdm/windows/enroll`                              | WSTEP enrollment            |
| `POST` | `/mdm/windows/management`                          | SyncML management           |

## Next

- [OpenAPI](/api/openapi)
- [Webhooks](/admin/operations)
