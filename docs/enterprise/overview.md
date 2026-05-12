# Mattrax Enterprise Overview

Mattrax Enterprise is the organization-scoped management product for enrolling devices, organizing them into groups, and applying policy configurations. The Enterprise API is implemented by `packages/enterprise-backend/` and defined by `packages/enterprise-domain/`.

## Core Concepts

| Concept | Meaning |
| ------- | ------- |
| Tenant | An organization boundary. Devices, groups, policies, APNs configuration, users, billing, and enrollments belong to a tenant. |
| User | A signed-in person using Mattrax Enterprise. A user can belong to one or more tenants. |
| Tenant member | The relationship between a user and a tenant. The member role controls what the user can do. |
| Invitation | A pending tenant membership invite sent to an email address. |
| Enrollment | A tenant-owned enrollment entry that controls which platforms can enroll and whether a code is required. |
| Device | A managed endpoint enrolled into a tenant. Devices can be Apple, Windows, or Android. |
| Group | A collection that links devices and policies. Groups are how policies are assigned to devices. |
| Policy | A named management intent containing one or more configurations. |
| Configuration | A typed payload inside a policy. Each configuration is stored by `kind` and contains platform-specific management data. |
| APNs | The Apple Push Notification service certificate and topic for a tenant. Required for Apple device management. |
| Billing | The tenant billing summary, including plan, subscription status, and billable enrolled device count. |

## Tenants

A tenant is the top-level Enterprise boundary. Most API routes are scoped by `tenantId`, and the backend checks that the current user is a member of that tenant before returning data.

Tenant records include:

| Field | Purpose |
| ----- | ------- |
| `id` | Stable tenant identifier used in API paths. |
| `name` | Display name. |
| `slug` | URL-friendly tenant name. |
| `logo` | Optional tenant logo. |
| `metadata` | Optional tenant metadata. |
| `role` | Current user's role in the tenant. |

Write operations require an `owner` or `admin` role. Tenant deletion requires `owner` and is blocked when the tenant still has more than one user.

## Users, Members, And Invitations

Users authenticate with the platform, then access tenants through memberships. A member has a role string such as `owner`, `admin`, or `member`.

Tenant admins can:

| Action | Description |
| ------ | ----------- |
| List users | View tenant members. |
| Invite users | Create invitations for email addresses. |
| List invitations | View pending or historical invitations. |
| Cancel invitations | Revoke an invitation before it is accepted. |
| Change roles | Update a member role. |
| Remove users | Remove a member, as long as they are not the last tenant user. |

## Enrollments

An enrollment controls how new devices join a tenant. It can require a code, limit the number of devices, and enable or disable platform-specific enrollment.

Enrollment settings include:

| Setting | Meaning |
| ------- | ------- |
| `code` | Optional code required before returning authenticated enrollment options. |
| `enabledApple` | Allows Apple enrollment when true. |
| `enabledWindows` | Allows Windows enrollment when true. |
| `enabledAndroid` | Allows Android enrollment when true. |
| `enabledAssetTag` | Allows asset tag collection during enrollment when true. |
| `maxDevices` | Maximum devices allowed for the enrollment. |

For Apple enrollment, the tenant must also have APNs configured. If APNs is missing, the enrollment response returns an Apple-specific error instead of a profile.

## Devices

A device is an enrolled endpoint in a tenant. Devices have a protocol, lifecycle status, inventory fields, and editable operator fields.

Supported device protocols are:

| Protocol | Meaning |
| -------- | ------- |
| `apple` | Apple MDM device. |
| `win` | Windows device. |
| `android` | Android device. |

Device statuses are:

| Status | Meaning |
| ------ | ------- |
| `enrolling` | Device has started enrollment. |
| `enrolled` | Device is actively managed. |
| `unenrolling` | Tenant has requested unenrollment. |
| `unenrolled` | Device is no longer actively managed. |

Operators can update device `name`, `notes`, and `assetTag`. Unenrolling a device sets enrolled devices to `unenrolling`, allowing the device management layer to complete the protocol-specific unenrollment flow.

## Groups

Groups connect devices and policies. A group can contain many devices and many policies, and the same device or policy can belong to multiple groups.

Group records include:

| Field | Purpose |
| ----- | ------- |
| `id` | Stable group identifier. |
| `name` | Display name. |
| `notes` | Optional operator notes. |
| `devicesCount` | Count of assigned devices when returned by list views. |
| `policiesCount` | Count of assigned policies when returned by list views. |
| `createdAt` / `updatedAt` | Audit timestamps. |

Group membership updates use explicit `assign` and `unassign` lists for devices and policies. The backend validates that referenced devices and policies belong to the same tenant before changing membership.

## Policies

A policy is a named management intent. Policies do not target devices directly; they become effective through group assignment.

Policy records include:

| Field | Purpose |
| ----- | ------- |
| `id` | Stable policy identifier. |
| `name` | Display name. |
| `notes` | Optional operator notes. |
| `configurations` | Optional map of configuration kind to configuration data. |
| `createdAt` / `updatedAt` | Audit timestamps. |

Policies can be created, patched, duplicated, deleted, and synced. Duplicating a policy copies its configurations to a new policy.

## Configurations

A configuration is stored inside a policy by `kind`. The backend persists each configuration as JSON data plus a hash of that data.

Patch behavior:

| Input | Result |
| ----- | ------ |
| `{ "someKind": { ... } }` | Creates or replaces the `someKind` configuration. |
| `{ "someKind": null }` | Deletes the `someKind` configuration. |

This lets a policy contain multiple independent configuration payloads while still updating or removing each configuration type independently.

## APNs

APNs configuration belongs to a tenant and is required for Apple management. The stored APNs record includes an email address, certificate PEM, and MDM topic.

When a certificate is uploaded, the backend extracts the topic from the certificate `UID` when possible. If no topic is found, it falls back to a tenant-specific placeholder topic.

## Search And Nodes

Enterprise exposes two generic lookup patterns:

| Feature | Description |
| ------- | ----------- |
| Search | Lists rows for `device`, `group`, or `policy` within a tenant. |
| Node lookup | Fetches a single `device`, `group`, or `policy` by ID. |

Node lookup is used when the UI needs the detail representation for one entity. Policy node responses include configurations.

## Billing

Billing is tenant-scoped. The summary includes the current plan, subscription status, subscription ID, and billable device count.

Billable devices are counted from devices in the `enrolled` status.
