# mattraxd

`mattraxd` is the Mattrax on-device daemon. It is what actually runs a script
on a device. MDM alone cannot execute arbitrary code: Apple has no command that
runs a shell script, Windows MDM has no arbitrary-script CSP (Microsoft's own
answer is the Intune Management Extension) and the Android Management API has no
script command. `mattraxd` closes that gap for Apple and Windows and posts one
signed result per run back to Mattrax.

## How delivery works

1. An operator creates a script and assigns it to devices or groups.
2. On each Apple check-in, the server installs one `.mobileconfig` per assigned
   script with a `com.mattrax.script` payload. Reinstalling the profile replaces
   the previous copy; removing the assignment removes the profile.
3. The payload carries the script body, shell, run-as, timeout, environment
   (and the names to redact), its trigger and a device bearer token.
4. `mattraxd` evaluates triggers (`install`, `login`, `logout`,
   `network-change`, `interval`, `cron`, `manual`) and runs the body.
5. It posts the exit code, capped and redacted stdout/stderr and duration to
   `POST /api/v1/script-agent/results` with
   `Authorization: Bearer <DeviceToken>`. The token is an HMAC over the device
   id, so it cannot be reused for another device and rotates with `AUTH_SECRET`.
6. A manual run installs the same profile with a new `RunID`. `mattraxd` runs it
   exactly once and remembers the id in `/var/lib/mattrax/mattraxd-state.json`.

Windows uses the same result contract through
`GET /api/v1/script-agent/scripts` (assigned scripts plus a pending `runId`).
There is no arbitrary-script CSP to deliver a profile, so the Windows build of
`mattraxd` must be installed separately; that artifact is not built in this
repository (see "Blocked by signing credentials" below).

## Build

macOS (verified with Swift 6.4):

```sh
apps/mattraxd/scripts/build-macos.sh
```

Artifact: `apps/mattraxd/build/mattraxd-<version>.pkg`.

The script installs:

- `/usr/local/libexec/mattraxd`
- `/Library/LaunchDaemons/com.mattrax.mattraxd.plist` (keeps the daemon running)
- `/var/lib/mattrax/mattraxd-state.json` (created on first run)
- `/var/log/mattraxd.log`

Run it once in the foreground for debugging:

```sh
sudo /usr/local/libexec/mattraxd once
sudo /usr/local/libexec/mattraxd version
```

## Signing and notarization

A Mac refuses to load an unsigned LaunchDaemon in a normal security posture, so
shipping requires:

| Step                                      | Credential                                     |
| ----------------------------------------- | ---------------------------------------------- |
| Sign the binary with the hardened runtime | `DEVELOPER_ID_APPLICATION`                     |
| Sign the `.pkg`                           | `DEVELOPER_ID_INSTALLER`                       |
| Notarize and staple                       | `NOTARY_PROFILE` (notarytool keychain profile) |

```sh
DEVELOPER_ID_APPLICATION="Developer ID Application: Acme (TEAMID)" \
DEVELOPER_ID_INSTALLER="Developer ID Installer: Acme (TEAMID)" \
NOTARY_PROFILE="mattrax-notary" \
apps/mattraxd/scripts/build-macos.sh
```

Without these credentials the build still produces a package, but it is
unsigned: Gatekeeper blocks it on any other Mac and the daemon cannot be
notarized. Windows additionally needs an Authenticode certificate for the
`mattraxd` executable and an MSI/MSIX package; neither certificate is present in
this repository.

## Result contract

```json
{
  "runId": "run or execution id",
  "scriptId": "script id",
  "trigger": "manual",
  "exitCode": 0,
  "stdout": "…",
  "stderr": "",
  "durationMs": 42,
  "startedAt": "2026-11-16T12:00:00.000Z",
  "finishedAt": "2026-11-16T12:00:00.042Z",
  "detail": null,
  "timedOut": false
}
```

The server re-applies the 64 KiB per-stream cap, redacts environment values
marked secret, stores the result and writes one `script.run_completed` or
`script.run_failed` entry to the device timeline.

## State and privacy

- `/var/lib/mattrax/mattraxd-state.json` holds executed manual run ids, trigger
  timestamps, the last boot time, console user and a network fingerprint. It
  never stores script bodies or output; both live in the installed profile and
  the server.
- `/var/log/mattraxd.log` records trigger decisions and exit codes, not
  stdout/stderr.
- A user-context script runs through `launchctl asuser <uid>` and is skipped when
  no console user is logged in (with a reason in the result).
