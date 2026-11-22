# OS version management

Mattrax tracks the OS version each device reports and can compare it with a
tenant minimum. The **OS versions** page (`/t/:tenantId/os-versions`) shows the
distribution by platform and version, who is below the minimum, and what the
platform can actually do about it. The policy itself lives in **Settings → OS
updates**.

## What a policy contains

Each platform family has its own rule:

| Field           | Meaning                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------- |
| Minimum version | A dotted version such as `18.1`, `15.0`, `10.0.22631` or `14`. Marketing names are rejected. |
| Enforcement     | `off`, `warn` or `enforce`.                                                                  |
| Deferral window | Days a device may stay below the minimum before it counts as non-compliant.                  |

The platform families are macOS, iOS, iPadOS, Windows and Android. macOS, iOS
and iPadOS have separate rules because their version numbers and release
cadence differ: an iOS 18.1 minimum is not an iPadOS or macOS minimum.

tvOS, watchOS and visionOS are **explicitly unsupported**. Apple's declarative
software-update declaration exists for tvOS 18.4+ and visionOS 26+, but Mattrax
has no update guidance or remediation path for those families and Apple does not
support watchOS at all. Their devices are reported as `Not supported` on the
device page, and the fleet page counts them separately rather than dropping
them from the totals. They are never counted as compliant and never as a
silent "unknown". A tenant that needs those families should keep them in
another MDM.

A device is only compared with the minimum for its own family. Changing a rule
restarts its deferral window: `deferralDays` is measured from the time the rule
was last saved.

## Compliance statuses

Every device gets one of four statuses:

- **compliant** — the reported version is at or above the minimum, and either
  the platform has no newer-release feed (Windows, Android, iOS, iPadOS) or the
  Apple release feed says the device is on the published release (macOS).
- **update-available** — the device may meet the minimum, but a newer release is
  known: macOS from SOFA, or any Apple family from Apple's DDM
  `softwareupdate.pending-version` / `softwareupdate.install-state` status
  items. A device still inside an active deferral window is also reported here
  with the reason `deferral_active`; it is **not** treated as compliant.
- **below-minimum** — the reported version is older than the configured
  minimum and the deferral window has ended.
- **unknown** — the version was never reported, cannot be parsed, the platform
  is not covered, the Apple family is explicitly unsupported (tvOS, watchOS,
  visionOS), or macOS release knowledge is unavailable. Unknown is never
  counted as compliant.

Windows and Android have no external update feed. Their result is
`compliant` with `updateKnowledge: unknown`: Mattrax knows the device meets the
minimum, and does not claim to know whether a newer release exists.

iOS and iPadOS have no public release feed in Mattrax either. A device that
meets the minimum is `compliant` with `updateKnowledge: unknown`; when Apple
reports a pending update, the result becomes `update-available` with the reason
`ddm_update_pending` and the pending version as the target.

macOS release knowledge comes from the SOFA feed. If the feed is unavailable,
a macOS device that meets its minimum stays **unknown** rather than compliant.

## What enforcement actually does

`warn` changes no device; it only changes how the device is reported.
`enforce` also applies the platform's remediation:

| Platform    | Mechanism                                                                                          | Applied automatically                             | Minimum version enforced                   |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| macOS 14+   | DDM `com.apple.configuration.softwareupdate.enforcement.specific`                                  | Yes, on the next declaration sync                 | Yes, as `TargetOSVersion`                  |
| iOS 17+     | DDM `com.apple.configuration.softwareupdate.enforcement.specific`                                  | Yes, on the next declaration sync                 | Yes, as `TargetOSVersion`                  |
| iPadOS 17+  | DDM `com.apple.configuration.softwareupdate.enforcement.specific`                                  | Yes, on the next declaration sync                 | Yes, as `TargetOSVersion`                  |
| Older Apple | Apple `ScheduleOSUpdate` command (explicit fallback)                                               | No — use **Apply update** on the OS versions page | Yes, through the command                   |
| Windows     | Windows Update for Business ring: automatic updates, quality/feature deferral and install deadline | Yes, on the next SyncML check-in                  | No — Windows has no minimum-version CSP    |
| Android     | Android Management API `systemUpdate: AUTO`                                                        | Yes, on the next policy sync                      | No — Android has no minimum-version policy |

The DDM declaration carries the rule's minimum as `TargetOSVersion` and the
deferral deadline (or the time the rule was saved when there is no deferral) as
`TargetLocalDateTime`. Every supervised device that can apply declarations
fetches it on its next sync; no policy assignment or push is required. Editing
the rule, including restarting the deferral, rotates the declaration's server
token so capable devices fetch it again.

The fallback is explicit in the product:

- `ScheduleOSUpdate` is only advertised on iOS/iPadOS below 17, on a device
  whose recorded delivery mode is `legacy`, or above the OS version where Apple
  removes the command (27). On macOS it remains available as the manual
  override it has always been.
- User-enrolled (BYOD) Apple devices are never offered the fallback: Apple
  requires supervision for both the command and the system-scoped declaration.
- A fallback command is audited with `mechanism: "schedule-os-update"` and the
  install action, so the audit trail distinguishes it from a DDM delivery.

The UI repeats these limitations next to every rule. In particular:

- Apple only installs a `TargetOSVersion` its servers still publish. Mattrax has
  no GDMF lookup for iOS/iPadOS, so a declaration can stay active without an
  update if Apple withdraws that exact version. Re-enter a current version when
  the target changes.
- Apple force-installs at `TargetLocalDateTime` interpreted in the device's local
  time. Mattrax sends the UTC wall clock because a tenant device time zone is
  not reported, so a device outside UTC may see the deadline shifted.
- Apple's `ScheduleOSUpdate` has no absolute deadline. `InstallLater` plus
  `MaxUserDeferrals` is the closest supported shape, and the command runs on the
  device's next check-in.
- The Windows settings are an update ring and deadline, not "refuse to run below
  version X". The minimum remains a compliance check.
- Android's system update policy supports `AUTO`, `WINDOWED` and `POSTPONE`.
  Mattrax uses `AUTO` for enforcement; deferral is not expressible there.

## Remediating devices

On the OS versions page, Apple devices below the minimum (or with an update
available/pending) can be selected and updated in bulk:

- **Apple devices with the DDM declaration** receive an APNs wake-up and apply
  the tenant rule on their next check-in. The confirmation names how many
  devices use this path.
- **Apple devices without DDM** (below macOS 14 / iOS/iPadOS 17, or on legacy
  delivery) receive `ScheduleOSUpdate` with `InstallASAP` as the explicit
  fallback; the confirmation warns that the device may restart.

Every device call is a separate audited `device.action`, so a bulk apply leaves
one trail per device.

The device page has a finer control for the command path: install immediately,
install later with a deadline (converted to a bounded deferral count), or notify
only. Apple ignores that command while a DDM declaration manages the same
update, so on a capable device prefer the tenant policy. The page also shows
the DDM software-update state Apple reports (`softwareupdate.install-state`,
the pending version, and the last failure) next to the compliance badge.

Windows and Android show no per-device update command. Their enforcement is
applied through the update policy on the next check-in, and the page says so
rather than offering a button that would not work.

## Permissions

Viewing policies and the fleet view requires `devices.read`. Changing a policy
requires `devices.write` and a step-up confirmation. Applying an update in bulk
requires `devices.command`. All queries are tenant-scoped.
