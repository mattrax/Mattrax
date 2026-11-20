# mattraxd

`mattraxd` is the Mattrax on-device daemon, written in Rust. It is what actually
runs a script on a device. MDM alone cannot execute arbitrary code: Apple has no
command that runs a shell script, Windows MDM has no arbitrary-script CSP
(Microsoft's own answer is the Intune Management Extension) and the Android
Management API has no script command. `mattraxd` closes that gap for Apple and
Windows and posts one signed result per run back to Mattrax.

The Swift implementation this replaces lived in `macos/Sources/main.swift` until
1.0. The Rust crate is now the only implementation; `scripts/build-macos.sh`
builds it and packages the same payload layout.

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

### Trigger payload names

The server has shipped two vocabularies for the trigger field. Both are
accepted and behave identically:

| Logical trigger | Profile `Type` values |
| --- | --- |
| `install` | `install` |
| `startup` | `startup` |
| `login` / `logout` | `login` / `logout` |
| `network-change` | `network-change`, `networkstatechange` |
| `interval` | `interval`, `timer` with `TimerInterval` |
| `cron` | `cron`, `timer` with `CronExpression` |
| `manual` | `manual` |

The raw profile value is still part of the script digest, so upgrading from the
Swift agent does not re-fire an install trigger. Environment entries are hashed
in sorted order (the Swift agent hashed dictionary order), so a profile whose
environment was previously delivered in a different order can fire `install`
once after the upgrade; profiles without environment entries are unaffected.

Windows uses the same result contract through
`GET /api/v1/script-agent/scripts` (assigned scripts plus a pending `runId`).
The release workflow builds and packages a Windows executable, but Windows
script delivery is not implemented in this rewrite (there is no profile store
and no provisioning path for the device token yet). A Windows device runs no
scripts until that source lands; the binary is published so signing, packaging
and the updater are exercised on that platform.

## Install

macOS package (signed and notarized when the release workflow had credentials):

```sh
sudo installer -pkg mattraxd-<version>.pkg -target /
```

The package installs:

- `/usr/local/libexec/mattraxd`
- `/Library/LaunchDaemons/com.mattrax.mattraxd.plist` (keeps the daemon running)
- `/var/lib/mattrax/mattraxd-state.json` (created on first run)
- `/var/log/mattraxd.log`

The postinstall script bootstraps the LaunchDaemon. The plist invokes the hidden
runtime command explicitly:

```xml
<array>
  <string>/usr/local/libexec/mattraxd</string>
  <string>agent</string>
  <string>run</string>
</array>
```

## Command surface

| Command | Visibility | Purpose |
| --- | --- | --- |
| `mattraxd version` | public | Print `mattraxd <version>`; the same string is embedded via `--version`. |
| `mattraxd update --channel stable\|latest [--check] [--restart] [--force]` | public | Self-update from a signed release manifest. |
| `mattraxd agent run` | hidden | The daemon loop (30 second ticks). The launchd invocation. |
| `mattraxd agent once` | hidden | Evaluate every script trigger once and exit. |
| `mattraxd run`, `mattraxd once` | hidden | 1.0 compatibility aliases. A device updated in place keeps its old plist until the next pkg install, so these must keep working. |
| `mattraxd` (no command) | hidden default | Same as `agent run`, kept so an old plist or operator habit keeps working. |

`update` is public because it is a supported, idempotent operator action, not a
debug hook; the top level stays free for the admin commands planned for enrolled
devices. Runtime commands are hidden under `agent` because they are not an
operator interface: the daemon must only be started by launchd.

Debug a device in the foreground:

```sh
sudo /usr/local/libexec/mattraxd agent once
sudo /usr/local/libexec/mattraxd version
sudo /usr/local/libexec/mattraxd agent run   # foreground daemon
```

Exit codes:

- `0` success, including `--check` and an already up-to-date agent;
- `1` an update failed (manifest, signature, checksum, download, replace, restart);
- `64` invalid command line (the Swift agent's usage exit code).

## Update

```sh
# Is there a newer stable build?
sudo mattraxd update --channel stable --check

# Install it and restart the daemon
sudo mattraxd update --channel stable --restart

# Follow the newest build, including prereleases and nightly
sudo mattraxd update --channel latest --restart
```

Channels:

- **stable** follows the newest non-prerelease `mattraxd-v*` tag.
- **latest** follows the newest published build, including prereleases and the
  nightly schedule. Switching from `latest` to `stable` can therefore be a
  downgrade and is refused without `--force`.

`--force` also allows a downgrade. A same-version manifest is a no-op.

The agent fetches `stable.json` or `latest.json` from the rolling
`agent-channels` GitHub release:

```text
https://github.com/mattrax/Mattrax/releases/download/agent-channels/stable.json
https://github.com/mattrax/Mattrax/releases/download/agent-channels/latest.json
```

`nightly.json` is an informational pointer to the current nightly release
(`{"channel":"nightly","version":…,"release":…,"manifest":"latest.json"}`).
Agents do not read it; installers and dashboards can.

Self-hosted mirrors can override the base URL with `MATTRAX_UPDATE_BASE_URL` or
`--manifest-url <url>`. Both require HTTPS; `MATTRAX_UPDATE_ALLOW_INSECURE=1`
allows plain HTTP for local testing only.

### Manifest format

```json
{
  "schema": 1,
  "channel": "stable",
  "version": "1.1.0",
  "releasedAt": "2026-11-20T00:00:00Z",
  "signature": "base64 ed25519 signature",
  "artifacts": {
    "macos-aarch64": {
      "url": "https://github.com/mattrax/Mattrax/releases/download/mattraxd-v1.1.0/mattraxd-1.1.0-macos-universal",
      "sha256": "64 lowercase hex characters",
      "size": 1234567
    },
    "macos-x86_64": {
      "url": "https://…/mattraxd-1.1.0-macos-universal",
      "sha256": "…",
      "size": 1234567
    },
    "windows-x86_64": {
      "url": "https://…/mattraxd-1.1.0-windows-x86_64.exe",
      "sha256": "…",
      "size": 1234567
    }
  }
}
```

The signed payload is the compact JSON serialisation of the same object **without**
`signature`, with the field order above and `artifacts` sorted by platform.
Whitespace and formatting of the published file do not matter because the agent
rebuilds those exact bytes from the parsed manifest.

### Verification (fail closed)

Before the installed binary is touched, `update` checks, in order:

1. the manifest is HTTPS, has schema `1`, a semver `version`, a matching
   `channel` and a non-empty artifact set;
2. every artifact URL is HTTPS and every SHA-256 is 64 hex characters;
3. the Ed25519 signature over the canonical payload. Every deployed build is
   compiled with `MATTRAXD_UPDATE_PUBLIC_KEY` and refuses to update at all
   without a valid signature (or with no configured key). Only a local
   development build started with `MATTRAX_UPDATE_ALLOW_UNSIGNED=1` may fall
   back to checksums; releases never publish an unsigned manifest.
4. the remote version is not older than the running version (unless `--force`);
5. the downloaded bytes match the manifest's SHA-256;
6. the binary is flushed and renamed over the target atomically (on Windows the
   old binary is kept as a rollback until the rename succeeds);
7. `--restart` runs `launchctl kickstart -k system/com.mattrax.mattraxd`.

Any failure aborts and leaves the installed binary unchanged. The manifest
tooling is `mattraxd-manifest` in this crate; it is never installed.

### Update signing keys

The update signing key is Ed25519, stored as 64 hex characters (32-byte seed):

```sh
# Generate once, store as MATTRAXD_UPDATE_SIGNING_KEY
openssl rand -hex 32

# Derive the public key compiled into release binaries
MATTRAXD_UPDATE_SIGNING_KEY=<seed> cargo run --bin mattraxd-manifest -- public-key
```

The public key is a repository **variable** (`MATTRAXD_UPDATE_PUBLIC_KEY`);
it is not secret and must match the signing key. The publish job fails if they
disagree. Losing the seed means shipping agents that trust a new key: publish a
release signed with the new key and have operators reinstall, or keep the old
key trusted until the fleet is upgraded.

## Build

Rust 1.85 or newer:

```sh
cd apps/mattraxd
cargo test
cargo clippy --all-targets -- -D warnings
cargo build --release
```

Package for macOS (unsigned unless credentials are set; see below):

```sh
apps/mattraxd/scripts/build-macos.sh
```

Universal package (both architectures, lipo'd before signing):

```sh
MATTRAX_MATTRAXD_TARGETS="aarch64-apple-darwin x86_64-apple-darwin" \
  apps/mattraxd/scripts/build-macos.sh
```

Artifacts: `apps/mattraxd/build/mattraxd-<version>.pkg` and the bare signed
`apps/mattraxd/build/mattraxd` used by the updater. `MATTRAX_MATTRAXD_VERSION`
overrides the embedded version (the release workflow passes a nightly version);
the pkg's CFBundleVersion is the numeric prefix.

## Signing and notarization

A Mac refuses to load an unsigned LaunchDaemon in a normal security posture, so
shipping requires:

| Step | Credential |
| --- | --- |
| Sign the binary with the hardened runtime | `DEVELOPER_ID_APPLICATION` + `DEVELOPER_ID_APPLICATION_P12` + `DEVELOPER_ID_APPLICATION_PASSWORD` |
| Sign the `.pkg` | `DEVELOPER_ID_INSTALLER` + `DEVELOPER_ID_INSTALLER_P12` + `DEVELOPER_ID_INSTALLER_PASSWORD` |
| Notarize and staple | `NOTARY_PROFILE` + `NOTARY_APPLE_ID` + `NOTARY_TEAM_ID` + `NOTARY_PASSWORD` |
| Sign `mattraxd.exe` (Authenticode) | `WINDOWS_CERTIFICATE` (base64 PFX) + `WINDOWS_CERTIFICATE_PASSWORD` |
| Sign the update manifest | `MATTRAXD_UPDATE_SIGNING_KEY` (+ variable `MATTRAXD_UPDATE_PUBLIC_KEY`) |

The `*_P12` values are base64-encoded PKCS#12 files; the identity values are the
full keychain identity strings, for example
`Developer ID Application: Acme (TEAMID)`. CI creates a temporary keychain,
imports both certificates, stores a notarytool profile under `NOTARY_PROFILE`
(default `mattrax-notary`) and submits the pkg with `--wait` before stapling.

Without these credentials the workflow still produces an unsigned package and
zip, and an unsigned update manifest (unless the publish key is present, in
which case the manifest is signed but the binaries are not). Gatekeeper blocks
an unsigned package on another Mac, so a production release needs all of them.

## Release pipeline

`.github/workflows/release-agent.yml` is separate from `ci.yml` and
`deploy.yml`. It runs:

- **pull requests** touching `apps/mattraxd/**` or the workflow: fmt, clippy,
  tests on Linux, macOS and Windows builds, unsigned artifacts. No secrets.
- **tag push** `mattraxd-v<version>`: the same builds, signed when the secrets
  exist, published to a GitHub release with `mattraxd-manifest.json`; a tag
  without a prerelease suffix also advances `stable.json` and `latest.json`.
- **nightly** (03:17 UTC): builds the next patch prerelease
  (`1.1.0` becomes `1.1.1-nightly.<date>`, so it sorts above the stable build),
  publishes the prerelease `nightly-<date>`, advances `latest.json` and
  `nightly.json`.
- **workflow_dispatch**: `channel=nightly` does a manual nightly publish;
  `channel=stable` only builds and tests, so a stable release always goes
  through a reviewed tag.

Every third-party action is pinned by commit SHA. The publish job only runs on
trusted events and has `contents: write`; every other job is read-only.

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
  the server. The JSON shape is identical to the Swift agent's.
- `/var/log/mattraxd.log` records trigger decisions and exit codes, not
  stdout/stderr.
- A user-context script runs through `launchctl asuser <uid>` and is skipped when
  no console user is logged in (with a reason in the result).
- Captured output is capped at 64 KiB per stream. A timed-out script receives
  SIGTERM (as before) and, after a five second grace period, SIGKILL so a body
  that ignores SIGTERM cannot wedge the daemon.
