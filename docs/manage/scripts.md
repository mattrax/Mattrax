# Scripts

Scripts run shell code on managed devices. They are the fleet-automation layer on top of
settings management: an operator writes a script, assigns it to devices or groups, and the
device runs it on a schedule or on demand. Every run records its exit code and capped
stdout/stderr; terminal results reported by `mattraxd` also add a device timeline entry.

Scripts execute arbitrary code with administrator privileges when configured to run as
root. Treat the **Scripts write** permission as equivalent to remote root access.

## Create a script

1. Open **Scripts → New script**.
2. Enter a name and the script body (maximum 32 KiB).
3. Choose a shell: `bash`, `zsh`, `sh` or PowerShell (`pwsh`). `mattraxd` on macOS runs
   `bash`, `zsh` and `sh`; it reports a skipped run for `pwsh` rather than executing the
   body with a different shell.
4. Choose **Run as**:
   - **root** runs elevated. The device must have `mattraxd` installed as a system daemon.
   - **Logged-in user** runs in the console session. A trigger that fires without a
     logged-in user (install, interval, cron, network change) is skipped with a reason in
     the run history.
5. Set a timeout (1 second to 24 hours). `mattraxd` stops the script at the deadline.
6. Pick a trigger:
   - **Manual only** — runs when an operator presses Run.
   - **When the profile is installed** — runs once per device for each script revision.
     Changing only environment values reinstalls the profile but does not re-fire this
     trigger.
   - **User login / User logout** — runs on console-session changes.
   - **Network change** — runs when the device's interface/IP fingerprint changes.
   - **Every interval** — minimum 60 seconds, maximum 30 days.
   - **Cron schedule** — five fields (`minute hour day-of-month month day-of-week`),
     evaluated on the device in local time. Names such as `MON` are rejected.
7. Optionally add environment variables. Variables flagged **Secret** are exported to the
   script and their values are redacted from captured output on the device (the flag is
   carried in the profile as `SecretEnvironment`) and again before storage.
8. Save. Creating a script only needs the **Scripts write** permission; later edits,
   assignment changes and deletion require a fresh sign-in confirmation (step-up).

Script bodies are stored verbatim. Do not put credentials in the body: environment values
marked secret are the supported path, and output redaction removes their values plus
common credential shapes (`Bearer …`, `password=…`, PEM private keys, AWS/GitHub/Stripe
token prefixes).

## Assign

A script is delivered to a device when the device is directly assigned **or** belongs to an
assigned group. Assignments are tenant-scoped; a device or group from another tenant is
rejected.

- Apple: the server installs a `.mobileconfig` containing a `com.mattrax.script` payload
  with the body, shell, run-as, timeout, environment and trigger. Editing the script or
  queueing a manual run reinstalls the profile; removing the assignment removes it.
- Windows: no Windows MDM CSP can run arbitrary code. Microsoft's own answer is an agent
  (the Intune Management Extension). The same result contract is available to the Windows
  build of `mattraxd` through `GET /api/v1/script-agent/scripts`.
- Android: the Android Management API has no script command. Android devices are reported
  as skipped and no execution row is created for them.

Apple devices need the macOS build of `mattraxd` (build and signing instructions in
[`apps/mattraxd/README.md`](https://github.com/mattrax/Mattrax/tree/main/apps/mattraxd)).
The release workflow publishes a Windows `mattraxd.exe` zip. It does not implement the
script source (`GET /api/v1/script-agent/scripts`) yet, so Windows devices report no script
runs until that delivery path lands.

## Run on demand

**Run on assigned devices** queues one execution per assigned device. The run expires after
24 hours if the device never collects it. Repeating the click while a run is still queued
returns the existing run instead of creating a second one.

Running requires the **Scripts write** permission and a fresh step-up grant
(`script-run`). Creating a script needs only `scripts.write`; editing, assigning and
deleting an existing script require `script-change`.

## Results and history

The run history on a script shows every execution across devices, newest first, and can be
filtered to one device. Each row reports:

- trigger, status, exit code and duration;
- capped stdout/stderr (64 KiB per stream) with a copy and download button;
- the non-output failure detail (timeout, skipped trigger, `mattraxd` error).

Captured output is redacted on the device and again on the server. The server never trusts
`mattraxd`'s cap, because a compromised device can post any size it likes.

A terminal run reported by `mattraxd` also writes a `script.run_completed` or
`script.run_failed` entry to the device timeline. A queued run that expires without a
result has no device event. Metadata contains the script id and name, trigger, status, exit code,
duration and timeout flag — never output or environment values.

## Collect device attributes

A script can populate tenant-defined [device attributes](/manage/devices#custom-attributes).
Bind the attribute to the script in **Settings → Attributes**, then have the script print one
of:

- a JSON object keyed by attribute key (or the binding's **Output key**):
  `{"antivirus":"CrowdStrike","agent_version":"7.12"}`; or
- one value per line, in the attribute list order. A blank line is an empty value and
  is reported as an error; it does not shift the lines after it.

The server maps the result through the bindings declared in the tenant, validates every
value with the attribute's type, options and length, and writes only those attributes. An
unexpected key is ignored. A value of the wrong type, a missing key or line, an empty value
or a failed run records a per-device/per-attribute error and keeps the previous value
instead of writing a partial result.

Collection runs whenever the script runs, so an interval or cron trigger gives periodic
refreshes without another scheduler. Editing the script's output does not require re-arming
the trigger. The device page's **Collect now** button queues a single manual run for that
device through the normal run path (24-hour expiry, deduplication, 64 KiB output cap and
redaction), so it obeys the same limits as **Run on assigned devices**. The script must be
assigned to the device or one of its groups.

Every write is audited as a device attribute change with `source: script`, the script id and
the run id. Nothing else — environment values, stderr or unrelated stdout — is stored beyond
the existing run history.

**Platform support:** Apple only. Android has no script command, and the Windows agent does
not implement the script delivery channel yet, so both report attribute collection as
unsupported rather than queueing a run that never happens.

## Queue and retention

- A manual run is `queued` until the device reports a result, then `succeeded` or `failed`.
  Queued runs past their deadline become `expired`; the maintenance sweep does this even if
  no device checks in.
- Trigger runs are created by `mattraxd` and deduplicated on
  `(device, script, run id)`. A retried result post returns the existing row.
- Terminal history is retained for 30 days. Output can be large, so retention is
  deliberate; export anything you need to keep before then.
- Deleting a script removes its assignments and run history.

## Tenant opt-out

Scripts are enabled per tenant. **Disable scripts for this tenant** on the Scripts page:

- removes assigned script profiles from Apple devices (direct device assignments are
  pushed immediately; group members pick it up on their next check-in);
- rejects new create/run requests;
- stops the agent sync endpoint returning scripts;
- keeps existing history until normal retention expires.

Re-enabling delivers the currently assigned scripts again.

## API

| Method   | Path                                                | Purpose                                   |
| -------- | --------------------------------------------------- | ----------------------------------------- |
| `GET`    | `/api/v1/tenants/:tenantId/scripts`                 | List scripts and the tenant setting       |
| `POST`   | `/api/v1/tenants/:tenantId/scripts`                 | Create (`scripts.write`, no step-up)      |
| `GET`    | `/api/v1/tenants/:tenantId/scripts/:id`             | Script body and summary                   |
| `PATCH`  | `/api/v1/tenants/:tenantId/scripts/:id`             | Edit (step-up `script-change`)            |
| `DELETE` | `/api/v1/tenants/:tenantId/scripts/:id`             | Delete (step-up `script-change`)          |
| `GET`    | `/api/v1/tenants/:tenantId/scripts/:id/assignments` | Direct devices and groups                 |
| `PATCH`  | `/api/v1/tenants/:tenantId/scripts/:id/assignments` | Assign/unassign (step-up `script-change`) |
| `POST`   | `/api/v1/tenants/:tenantId/scripts/:id/run`         | Queue a run (step-up `script-run`)        |
| `GET`    | `/api/v1/tenants/:tenantId/scripts/:id/executions`  | Run history (`deviceId`, `limit`)         |
| `PATCH`  | `/api/v1/tenants/:tenantId/scripts/settings`        | Enable/disable scripts                    |

The device-facing channel is separate and authenticates with a device token, not a session:

| Method | Path                           | Purpose                                |
| ------ | ------------------------------ | -------------------------------------- |
| `GET`  | `/api/v1/script-agent/scripts` | Assigned scripts plus a pending run id |
| `POST` | `/api/v1/script-agent/results` | Post one terminal result               |

The `mattraxd` token is an HMAC over the device id using `AUTH_SECRET`. It is bound to one
device, cannot be used against another tenant, and is invalidated by rotating the secret
(re-enrol or re-deliver profiles afterwards).
