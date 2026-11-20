# OS version management

Mattrax tracks the OS version each device reports and can compare it with a
tenant minimum. The **OS versions** page (`/t/:tenantId/os-versions`) shows the
distribution by platform and version, who is below the minimum, and what the
platform can actually do about it. The policy itself lives in **Settings → OS
updates**.

## What a policy contains

Each platform family has its own rule:

| Field           | Meaning                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| Minimum version | A dotted version such as `15.0`, `10.0.22631` or `14`. Marketing names are rejected. |
| Enforcement     | `off`, `warn` or `enforce`.                                                          |
| Deferral window | Days a device may stay below the minimum before it counts as non-compliant.          |

The platform families are macOS, Windows and Android. iOS, iPadOS, tvOS,
watchOS and visionOS do not share macOS's version numbering or update feed, so a
single Apple minimum would compare unrelated versions. They are reported as
`platform not covered`, never as compliant.

A device is only compared with the minimum for its own family. Changing a rule
restarts its deferral window: `deferralDays` is measured from the time the rule
was last saved.

## Compliance statuses

Every device gets one of four statuses:

- **compliant** — the reported version is at or above the minimum, and either
  the platform has no newer-release feed (Windows, Android) or macOS is on the
  release Apple published.
- **update-available** — the device may meet the minimum, but a newer release is
  known (macOS, via SOFA). A device still inside an active deferral window is
  also reported here with the reason `deferral_active`; it is **not** treated as
  compliant.
- **below-minimum** — the reported version is older than the configured
  minimum and the deferral window has ended.
- **unknown** — the version was never reported, cannot be parsed, the platform
  is not covered, or macOS release knowledge is unavailable. Unknown is never
  counted as compliant.

Windows and Android have no external update feed. Their result is
`compliant` with `updateKnowledge: unknown`: Mattrax knows the device meets the
minimum, and does not claim to know whether a newer release exists.

macOS release knowledge comes from the SOFA feed. If the feed is unavailable,
a macOS device that meets its minimum stays **unknown** rather than compliant.

## What enforcement actually does

`warn` changes no device; it only changes how the device is reported.
`enforce` also applies the platform's remediation:

| Platform | Mechanism                                                                                          | Applied automatically                                                | Minimum version enforced                   |
| -------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| macOS    | Apple `ScheduleOSUpdate` command                                                                   | No — use **Apply update** on the OS versions page or the device page | Yes, through the command                   |
| Windows  | Windows Update for Business ring: automatic updates, quality/feature deferral and install deadline | Yes, on the next SyncML check-in                                     | No — Windows has no minimum-version CSP    |
| Android  | Android Management API `systemUpdate: AUTO`                                                        | Yes, on the next policy sync                                         | No — Android has no minimum-version policy |

The UI repeats these limitations next to every rule. In particular:

- Apple's `ScheduleOSUpdate` has no absolute deadline. `InstallLater` plus
  `MaxUserDeferrals` is the closest supported shape, and the command runs on the
  device's next check-in. Mattrax does not queue it automatically.
- The Windows settings are an update ring and deadline, not "refuse to run below
  version X". The minimum remains a compliance check.
- Android's system update policy supports `AUTO`, `WINDOWED` and `POSTPONE`.
  Mattrax uses `AUTO` for enforcement; deferral is not expressible there.

## Remediating devices

On the OS versions page, macOS devices below the minimum (or with an update
available) can be selected and updated in bulk. Each device receives one
`ScheduleOSUpdate` command with `InstallASAP`; confirmation names the count and
warns that the Mac may restart on its next check-in.

The device page has a finer control: install immediately, install later with a
deadline (converted to a bounded deferral count), or notify only.

Windows and Android show no per-device update command. Their enforcement is
applied through the update policy on the next check-in, and the page says so
rather than offering a button that would not work.

## Permissions

Viewing policies and the fleet view requires `devices.read`. Changing a policy
requires `devices.write` and a step-up confirmation. Sending a macOS update
command requires `devices.command`. All queries are tenant-scoped.
