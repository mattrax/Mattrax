//! Restricted software enforcement on macOS.
//!
//! The server installs one `com.mattrax.restricted-software` payload per rule.
//! This module reads those payloads, matches running processes or application
//! bundles, and posts a result to the signed agent endpoint. Only the two
//! actions the agent can actually perform arrive here: process-name or bundle
//! matching for `kill-process`, and bundle matching for `delete-app`. A
//! `block-install` rule has no pre-install hook on macOS and is never delivered.
//!
//! Every command is invoked with explicit arguments (never a shell), and bundle
//! deletion is restricted to `/Applications` and a user's own `Applications`
//! directory, so a malformed profile cannot turn into an arbitrary file delete.

use crate::logging::Logger;
use crate::profiles::installed_profile_values;
use crate::result::RestrictedResultQueue;
use crate::state::RestrictedState;
use crate::util;
use chrono::{DateTime, Local, SecondsFormat, Utc};
use plist::Value;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const DEFAULT_INTERVAL_SECONDS: i64 = 300;
const MIN_INTERVAL_SECONDS: i64 = 60;
const DETAIL_LIMIT: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledRestrictedSoftware {
    pub id: String,
    pub name: String,
    pub match_type: String,
    pub match_value: String,
    pub action: String,
    pub message: Option<String>,
    pub interval_seconds: i64,
    pub server_url: String,
    pub device_token: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestrictedResult {
    pub rule_id: String,
    pub action: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub killed_processes: usize,
    pub removed_applications: usize,
    pub occurred_at: String,
}

impl RestrictedResult {
    fn succeeded(
        rule: &InstalledRestrictedSoftware,
        killed: usize,
        removed: usize,
        detail: String,
    ) -> Self {
        Self {
            rule_id: rule.id.clone(),
            action: rule.action.clone(),
            status: "succeeded".into(),
            detail: Some(cap(detail)),
            killed_processes: killed,
            removed_applications: removed,
            occurred_at: iso(Utc::now()),
        }
    }

    fn failed(rule: &InstalledRestrictedSoftware, detail: String) -> Self {
        Self {
            rule_id: rule.id.clone(),
            action: rule.action.clone(),
            status: "failed".into(),
            detail: Some(cap(detail)),
            killed_processes: 0,
            removed_applications: 0,
            occurred_at: iso(Utc::now()),
        }
    }

    #[cfg_attr(target_os = "macos", allow(dead_code))]
    fn skipped(rule: &InstalledRestrictedSoftware, detail: String) -> Self {
        Self {
            rule_id: rule.id.clone(),
            action: rule.action.clone(),
            status: "skipped".into(),
            detail: Some(cap(detail)),
            killed_processes: 0,
            removed_applications: 0,
            occurred_at: iso(Utc::now()),
        }
    }

    /// A no-op pass is not worth an audit row on every timer tick.
    pub fn should_post(&self) -> bool {
        self.status != "succeeded" || self.killed_processes > 0 || self.removed_applications > 0
    }
}

fn cap(value: String) -> String {
    value.chars().take(DETAIL_LIMIT).collect()
}

fn iso(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn string<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .as_dictionary()
        .and_then(|dictionary| dictionary.get(key))
        .and_then(Value::as_string)
}

fn integer(value: &Value, key: &str) -> Option<i64> {
    value
        .as_dictionary()
        .and_then(|dictionary| dictionary.get(key))
        .and_then(|value| {
            value
                .as_signed_integer()
                .or_else(|| value.as_real().map(|number| number as i64))
        })
}

/// Parse one installed profile into restricted-software rules.
pub fn rules_from_profile(profile: &Value) -> Vec<InstalledRestrictedSoftware> {
    let Some(payloads) = profile
        .as_dictionary()
        .and_then(|profile| profile.get("PayloadContent"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    payloads
        .iter()
        .filter(|payload| {
            string(payload, "PayloadType") == Some(crate::RESTRICTED_SOFTWARE_PAYLOAD_TYPE)
        })
        .filter_map(|payload| {
            let id = string(payload, "RestrictedSoftwareID")?.to_owned();
            let match_type = string(payload, "MatchType")?.to_owned();
            let match_value = string(payload, "MatchValue")?.trim().to_owned();
            let action = string(payload, "Action")?.to_owned();
            let server_url = string(payload, "ServerURL")?.to_owned();
            let device_token = string(payload, "DeviceToken")?.to_owned();

            if match_value.is_empty() {
                return None;
            }

            if match_type != "bundle-id" && match_type != "process-name" {
                return None;
            }

            if action != "kill-process" && action != "delete-app" {
                return None;
            }

            Some(InstalledRestrictedSoftware {
                name: string(payload, "PayloadDisplayName")
                    .unwrap_or(&id)
                    .to_owned(),
                id,
                match_type,
                match_value,
                action,
                message: string(payload, "Message")
                    .filter(|message| !message.trim().is_empty())
                    .map(str::to_owned),
                interval_seconds: integer(payload, "IntervalSeconds")
                    .unwrap_or(DEFAULT_INTERVAL_SECONDS)
                    .max(MIN_INTERVAL_SECONDS),
                server_url,
                device_token,
            })
        })
        .collect()
}

pub fn installed_restricted_software() -> Vec<InstalledRestrictedSoftware> {
    installed_restricted_software_from_profiles(&installed_profile_values())
}

/// Parse rules from a profile snapshot already collected for this tick.
pub(crate) fn installed_restricted_software_from_profiles(
    profiles: &[Value],
) -> Vec<InstalledRestrictedSoftware> {
    profiles.iter().flat_map(rules_from_profile).collect()
}

/// A stable digest of the rule fields that change enforcement behaviour.
pub fn rule_digest(rule: &InstalledRestrictedSoftware) -> String {
    let input = format!(
        "{}|{}|{}|{}|{}",
        rule.id, rule.match_type, rule.match_value, rule.action, rule.interval_seconds
    );

    util::fnv1a64_hex(input.as_bytes())
}

pub trait RestrictedRunner {
    fn snapshot(&self, include_bundles: bool) -> EnforcementSnapshot;
    fn enforce(
        &self,
        rule: &InstalledRestrictedSoftware,
        snapshot: &EnforcementSnapshot,
    ) -> RestrictedResult;
    fn post(&self, rule: &InstalledRestrictedSoftware, result: &RestrictedResult, logger: &Logger);
}

/// The process table and bundle inventory collected once for an enforcement
/// tick. Rules only filter this snapshot; destructive actions still revalidate
/// their targets immediately before signalling or deletion.
#[derive(Debug, Clone)]
pub struct EnforcementSnapshot {
    pub(crate) processes: Result<Vec<(u32, String)>, String>,
    pub(crate) bundles: Vec<BundleSnapshot>,
    pub(crate) allowed_roots: Vec<PathBuf>,
}

#[derive(Debug, Clone)]
pub(crate) struct BundleSnapshot {
    pub(crate) path: PathBuf,
    pub(crate) identifier: String,
}

pub struct LiveRestrictedRunner {
    results: RestrictedResultQueue,
}

impl LiveRestrictedRunner {
    pub fn new(results: RestrictedResultQueue) -> Self {
        Self { results }
    }
}

impl RestrictedRunner for LiveRestrictedRunner {
    fn snapshot(&self, include_bundles: bool) -> EnforcementSnapshot {
        live_snapshot(include_bundles)
    }

    fn enforce(
        &self,
        rule: &InstalledRestrictedSoftware,
        snapshot: &EnforcementSnapshot,
    ) -> RestrictedResult {
        enforce_live(rule, snapshot)
    }

    fn post(&self, rule: &InstalledRestrictedSoftware, result: &RestrictedResult, logger: &Logger) {
        self.results.enqueue(rule, result);
        logger.log(format!("{} result queued", rule.id));
    }
}

/// One scheduling pass. Pure except for the injected runner, so a test can
/// assert due decisions and posting without touching processes.
pub fn tick(
    rules: &[InstalledRestrictedSoftware],
    state: &mut BTreeMap<String, RestrictedState>,
    now: DateTime<Local>,
    runner: &dyn RestrictedRunner,
    logger: &Logger,
) {
    let now_seconds = now.timestamp();
    let due: Vec<_> = rules
        .iter()
        .filter_map(|rule| {
            let entry = state.entry(rule.id.clone()).or_default();
            let digest = rule_digest(rule);
            (entry.digest != digest || now_seconds - entry.last_run >= rule.interval_seconds)
                .then_some((rule, digest))
        })
        .collect();

    if due.is_empty() {
        return;
    }

    let include_bundles = due.iter().any(|(rule, _)| rule.match_type == "bundle-id");
    let snapshot = runner.snapshot(include_bundles);

    for (rule, digest) in due {
        let result = runner.enforce(rule, &snapshot);

        if result.should_post() {
            runner.post(rule, &result, logger);
        }

        logger.log(format!(
            "{} enforced ({}) killed={} removed={}",
            rule.id, result.status, result.killed_processes, result.removed_applications
        ));

        let entry = state.entry(rule.id.clone()).or_default();
        entry.last_run = now_seconds;
        entry.digest = digest;
    }
}

pub fn endpoint_for(server_url: &str) -> String {
    format!(
        "{}/v1/restricted-software-agent/results",
        server_url.trim_matches('/')
    )
}

fn enforce_live(
    rule: &InstalledRestrictedSoftware,
    snapshot: &EnforcementSnapshot,
) -> RestrictedResult {
    #[cfg(target_os = "macos")]
    {
        enforce_macos(rule, snapshot)
    }

    #[cfg(not(target_os = "macos"))]
    {
        RestrictedResult::skipped(
            rule,
            "Restricted software enforcement is only supported on macOS.".into(),
        )
    }
}

/// Process names a rule cannot target. Mirrors the server-side validation; the
/// agent checks again because a profile could predate a server-side rule.
pub const DANGEROUS_PROCESS_NAMES: &[&str] = &[
    "launchd",
    "kernel_task",
    "windowserver",
    "loginwindow",
    "mattraxd",
    "securityd",
    "configd",
    "opendirectoryd",
    "syslogd",
    "notifyd",
    "powerd",
    "coreaudiod",
    "runningboardd",
    "springboard",
    "backboardd",
    "logd",
    "watchdogd",
    "sandboxd",
    "tccd",
    "authd",
    "cfprefsd",
    "diskarbitrationd",
    "coreservicesd",
    "launchservicesd",
];

pub fn normalise_process_name(value: &str) -> String {
    let trimmed = value.trim();
    let without_app = trimmed
        .to_lowercase()
        .strip_suffix(".app")
        .map(str::to_owned)
        .unwrap_or_else(|| trimmed.to_lowercase());

    without_app
}

fn protected_process_name(name: &str) -> bool {
    DANGEROUS_PROCESS_NAMES.contains(&name)
}

/// A bundle is protected when it is a system application or Apple-signed.
/// Deletion and termination both refuse it before any signal is sent.
fn protected_bundle(bundle: &Path) -> bool {
    if bundle.to_string_lossy().starts_with("/System/") {
        return true;
    }

    bundle_identifier(bundle)
        .map(|identifier| identifier.to_lowercase().starts_with("com.apple."))
        .unwrap_or(true)
}

/// Bundles that are safe to terminate or remove. Symlinks, bundles outside the
/// managed roots and Apple system applications are excluded before the process
/// table is touched.
pub fn deletable_bundles(
    identifier: &str,
    roots: &[PathBuf],
    allowed_roots: &[PathBuf],
) -> Vec<PathBuf> {
    validated_bundles(
        identifier,
        &find_bundle_paths(identifier, roots, true),
        allowed_roots,
    )
}

fn validated_bundles(
    identifier: &str,
    candidates: &[PathBuf],
    allowed_roots: &[PathBuf],
) -> Vec<PathBuf> {
    candidates
        .iter()
        .filter(|bundle| !protected_bundle(bundle))
        .filter(|bundle| validate_bundle(bundle, allowed_roots, identifier).is_ok())
        .cloned()
        .collect()
}

fn bundles_for_rule(
    rule: &InstalledRestrictedSoftware,
    snapshot: &EnforcementSnapshot,
) -> Vec<PathBuf> {
    if rule.match_type != "bundle-id" {
        return Vec::new();
    }

    let candidates: Vec<_> = snapshot
        .bundles
        .iter()
        .filter(|bundle| bundle.identifier.eq_ignore_ascii_case(&rule.match_value))
        .map(|bundle| bundle.path.clone())
        .collect();

    // The inventory is shared, but a user-writable Applications directory is
    // not trusted. Re-check scope, symlinks and the identifier for every rule.
    validated_bundles(&rule.match_value, &candidates, &snapshot.allowed_roots)
}

#[cfg(target_os = "macos")]
fn live_snapshot(include_bundles: bool) -> EnforcementSnapshot {
    let allowed_roots = deletion_roots();
    let bundles = if include_bundles {
        bundle_snapshot(&bundle_roots_from(&allowed_roots))
    } else {
        Vec::new()
    };
    let processes = list_processes().map_err(|error| error.to_string());

    EnforcementSnapshot {
        processes,
        bundles,
        allowed_roots,
    }
}

#[cfg(not(target_os = "macos"))]
fn live_snapshot(_include_bundles: bool) -> EnforcementSnapshot {
    EnforcementSnapshot {
        processes: Ok(Vec::new()),
        bundles: Vec::new(),
        allowed_roots: Vec::new(),
    }
}

#[cfg(target_os = "macos")]
fn enforce_macos(
    rule: &InstalledRestrictedSoftware,
    snapshot: &EnforcementSnapshot,
) -> RestrictedResult {
    let bundles = bundles_for_rule(rule, snapshot);

    let processes = match &snapshot.processes {
        Ok(processes) => processes,
        Err(error) => {
            return RestrictedResult::failed(
                rule,
                format!("Could not read the process table: {error}"),
            )
        }
    };

    let matches = matching_processes(rule, processes, &bundles);
    let (stopped, kill_error) =
        terminate_matches_with(matches, rule, snapshot, &LiveProcessControl, 20);

    if let Some(error) = kill_error {
        return RestrictedResult::failed(rule, error);
    }

    if rule.action == "kill-process" {
        return RestrictedResult::succeeded(
            rule,
            stopped,
            0,
            if stopped == 0 {
                "No matching process was running.".into()
            } else {
                format!("Terminated {stopped} matching process(es).")
            },
        );
    }

    let mut removed = 0;
    let mut failures = Vec::new();

    for bundle in &bundles {
        match remove_bundle(bundle, &snapshot.allowed_roots, &rule.match_value) {
            Ok(()) => removed += 1,
            Err(error) => failures.push(format!("{}: {error}", bundle.display())),
        }
    }

    // A bundle can be absent (already removed or matched by process name only).
    let detail = if failures.is_empty() {
        if removed == 0 {
            format!("Terminated {stopped} process(es); no matching application bundle was found.")
        } else {
            format!("Terminated {stopped} process(es) and removed {removed} application bundle(s).")
        }
    } else {
        failures.join("; ")
    };

    if failures.is_empty() {
        RestrictedResult::succeeded(rule, stopped, removed, detail)
    } else {
        RestrictedResult::failed(rule, detail)
    }
}

/// The directories that can contain an application we are willing to remove.
pub fn deletion_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];

    if let Ok(entries) = fs::read_dir("/Users") {
        for entry in entries.flatten() {
            let candidate = entry.path().join("Applications");

            if candidate.is_dir() {
                roots.push(candidate);
            }
        }
    }

    roots
}

fn bundle_roots_from(allowed_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut roots = allowed_roots.to_vec();
    let system = PathBuf::from("/System/Applications");

    if !roots.contains(&system) {
        roots.push(system);
    }

    roots
}

/// Find `.app` bundles with a matching bundle identifier. Only direct children
/// (and one nested level, for folders such as Utilities) are inspected.
pub fn find_bundle_paths(identifier: &str, roots: &[PathBuf], by_bundle_id: bool) -> Vec<PathBuf> {
    if !by_bundle_id {
        return Vec::new();
    }

    bundle_snapshot(roots)
        .into_iter()
        .filter(|bundle| bundle.identifier.eq_ignore_ascii_case(identifier))
        .map(|bundle| bundle.path)
        .collect()
}

fn bundle_snapshot(roots: &[PathBuf]) -> Vec<BundleSnapshot> {
    let mut found = Vec::new();

    for root in roots {
        collect_bundles(root, 0, &mut found);
    }

    found
}

fn collect_bundles(directory: &Path, depth: usize, found: &mut Vec<BundleSnapshot>) {
    if depth > 1 {
        return;
    }

    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.extension().and_then(|value| value.to_str()) == Some("app") {
            if let Some(identifier) = bundle_identifier(&path) {
                if !found.iter().any(|bundle| bundle.path == path) {
                    found.push(BundleSnapshot { path, identifier });
                }
            }

            continue;
        }

        if path.is_dir() {
            collect_bundles(&path, depth + 1, found);
        }
    }
}

fn bundle_identifier(bundle: &Path) -> Option<String> {
    let plist = bundle.join("Contents/Info.plist");
    let value: Value = plist::from_file(&plist).ok()?;

    string(&value, "CFBundleIdentifier").map(str::to_owned)
}

pub fn list_processes() -> std::io::Result<Vec<(u32, String)>> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .output()?;

    if !output.status.success() {
        return Err(std::io::Error::other("ps exited unsuccessfully"));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim().splitn(2, char::is_whitespace);
            let pid = parts.next()?.parse().ok()?;
            let command = parts.next()?.trim().to_owned();

            if command.is_empty() {
                None
            } else {
                Some((pid, command))
            }
        })
        .collect())
}

/// PIDs a rule matches. Bundle rules match the executable path inside the
/// bundle; process rules compare the executable's base name. PID 1, the agent
/// itself and known system processes are never returned.
pub fn matching_pids(
    rule: &InstalledRestrictedSoftware,
    processes: &[(u32, String)],
    bundles: &[PathBuf],
) -> Vec<u32> {
    matching_processes(rule, processes, bundles)
        .into_iter()
        .map(|(pid, _)| pid)
        .collect()
}

fn matching_processes(
    rule: &InstalledRestrictedSoftware,
    processes: &[(u32, String)],
    bundles: &[PathBuf],
) -> Vec<(u32, String)> {
    let process_rule = rule.match_type == "process-name";
    let value = if process_rule {
        normalise_process_name(&rule.match_value)
    } else {
        rule.match_value.to_lowercase()
    };
    let prefixes: Vec<String> = bundles
        .iter()
        .map(|bundle| {
            format!(
                "{}/contents/macos/",
                bundle
                    .to_string_lossy()
                    .trim_end_matches('/')
                    .to_lowercase()
            )
        })
        .collect();

    processes
        .iter()
        .filter_map(|(pid, command)| {
            if *pid <= 1 || *pid == std::process::id() {
                return None;
            }

            let command = command.to_lowercase();
            let base = Path::new(command.trim())
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(command.trim());

            if protected_process_name(base) {
                return None;
            }

            if process_rule {
                (base == value || normalise_process_name(base) == value).then_some((*pid, command))
            } else {
                let inside = prefixes.iter().any(|prefix| command.starts_with(prefix));

                (inside || command == value).then_some((*pid, command))
            }
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KillFailure {
    /// The process no longer exists (ESRCH).
    Gone,
    /// The caller is not allowed to signal it (EPERM).
    Permission,
    /// Any other errno.
    Failed(i32),
}

/// Small seam so termination can be tested without real processes.
pub trait ProcessControl {
    fn signal(&self, pid: u32, signal: i32) -> Result<(), KillFailure>;
    fn exists(&self, pid: u32) -> bool;
    /// Current executable path, when the platform can provide it without a
    /// process-table scan. Live enforcement fails closed when it is unknown.
    fn command(&self, _pid: u32) -> Option<String> {
        None
    }
}

pub struct LiveProcessControl;

#[cfg(unix)]
impl ProcessControl for LiveProcessControl {
    fn signal(&self, pid: u32, signal: i32) -> Result<(), KillFailure> {
        let result = unsafe { libc::kill(pid as libc::pid_t, signal) };

        if result == 0 {
            return Ok(());
        }

        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ESRCH) => Err(KillFailure::Gone),
            Some(libc::EPERM) => Err(KillFailure::Permission),
            Some(code) => Err(KillFailure::Failed(code)),
            None => Err(KillFailure::Failed(0)),
        }
    }

    fn exists(&self, pid: u32) -> bool {
        if pid == 0 {
            return false;
        }

        let result = unsafe { libc::kill(pid as libc::pid_t, 0) };

        if result == 0 {
            return true;
        }

        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ESRCH) => false,
            // EPERM means the process exists but is owned by another user.
            Some(libc::EPERM) => true,
            // Unknown errno: be conservative and treat it as present.
            _ => true,
        }
    }

    #[cfg(target_os = "macos")]
    fn command(&self, pid: u32) -> Option<String> {
        let mut buffer = [0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let length = unsafe {
            libc::proc_pidpath(
                pid as libc::c_int,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
            )
        };

        if length <= 0 {
            return None;
        }

        Some(
            String::from_utf8_lossy(&buffer[..length as usize])
                .trim_end_matches('\0')
                .to_owned(),
        )
    }
}

#[cfg(not(unix))]
impl ProcessControl for LiveProcessControl {
    fn signal(&self, _pid: u32, _signal: i32) -> Result<(), KillFailure> {
        Err(KillFailure::Failed(0))
    }

    fn exists(&self, _pid: u32) -> bool {
        false
    }
}

/// Terminate every PID, checking each signal result and re-checking after the
/// escalation. A process that remains after SIGKILL is a failure, not a silent
/// success.
pub fn terminate_with(
    pids: Vec<u32>,
    control: &dyn ProcessControl,
    grace_steps: u32,
) -> (usize, Option<String>) {
    let present: Vec<u32> = pids
        .into_iter()
        .filter(|pid| control.exists(*pid))
        .collect();

    if present.is_empty() {
        return (0, None);
    }

    let mut errors = Vec::new();

    for pid in &present {
        match control.signal(*pid, libc::SIGTERM) {
            Ok(()) | Err(KillFailure::Gone) => {}
            Err(KillFailure::Permission) => errors.push(format!("{pid}: permission denied")),
            Err(KillFailure::Failed(code)) => errors.push(format!("{pid}: signal failed ({code})")),
        }
    }

    for _ in 0..grace_steps {
        if present.iter().all(|pid| !control.exists(*pid)) {
            break;
        }

        std::thread::sleep(Duration::from_millis(100));
    }

    for pid in &present {
        if control.exists(*pid) {
            match control.signal(*pid, libc::SIGKILL) {
                Ok(()) | Err(KillFailure::Gone) => {}
                Err(KillFailure::Permission) => errors.push(format!("{pid}: SIGKILL denied")),
                Err(KillFailure::Failed(code)) => {
                    errors.push(format!("{pid}: SIGKILL failed ({code})"))
                }
            }
        }
    }

    let stopped = present.iter().filter(|pid| !control.exists(**pid)).count();
    let remaining = present.iter().filter(|pid| control.exists(**pid)).count();

    if remaining > 0 || !errors.is_empty() {
        let mut detail = errors;

        if remaining > 0 {
            detail.push(format!("{remaining} process(es) still running"));
        }

        return (stopped, Some(detail.join("; ")));
    }

    (stopped, None)
}

struct RecheckingProcessControl<'a> {
    control: &'a dyn ProcessControl,
    rule: &'a InstalledRestrictedSoftware,
    snapshot: &'a EnforcementSnapshot,
    bundles: Vec<PathBuf>,
}

impl RecheckingProcessControl<'_> {
    fn command_matches(&self, pid: u32, bundles: &[PathBuf]) -> bool {
        self.control.command(pid).is_some_and(|command| {
            matching_pids(self.rule, &[(pid, command)], bundles).contains(&pid)
        })
    }
}

impl ProcessControl for RecheckingProcessControl<'_> {
    fn signal(&self, pid: u32, signal: i32) -> Result<(), KillFailure> {
        // A shared snapshot can outlive a PID. Re-read the executable and
        // revalidate bundle targets immediately before every signal so a
        // recycled PID or swapped application is never signalled.
        let bundles = bundles_for_rule(self.rule, self.snapshot);
        if self.command_matches(pid, &bundles) {
            self.control.signal(pid, signal)
        } else {
            Err(KillFailure::Gone)
        }
    }

    fn exists(&self, pid: u32) -> bool {
        self.control.exists(pid) && self.command_matches(pid, &self.bundles)
    }

    fn command(&self, pid: u32) -> Option<String> {
        self.control.command(pid)
    }
}

fn terminate_matches_with(
    matches: Vec<(u32, String)>,
    rule: &InstalledRestrictedSoftware,
    snapshot: &EnforcementSnapshot,
    control: &dyn ProcessControl,
    grace_steps: u32,
) -> (usize, Option<String>) {
    let bundles = bundles_for_rule(rule, snapshot);
    let rechecking = RecheckingProcessControl {
        control,
        rule,
        snapshot,
        bundles: bundles.clone(),
    };
    let safe_pids = matches
        .into_iter()
        .filter_map(|(pid, _)| {
            (control.exists(pid) && rechecking.command_matches(pid, &bundles)).then_some(pid)
        })
        .collect();

    terminate_with(safe_pids, &rechecking, grace_steps)
}

pub fn terminate(pids: Vec<u32>) -> (usize, Option<String>) {
    terminate_with(pids, &LiveProcessControl, 20)
}

/// Validate one bundle before it is signalled or removed.
///
/// The entry itself must not be a symlink (the parent may be one, such as
/// /var on macOS), the canonical path must still be an `.app`, it must be
/// under a managed Applications root, it must not be an Apple system bundle,
/// and its Info.plist must still carry the identifier the rule matched.
pub fn validate_bundle(
    bundle: &Path,
    allowed_roots: &[PathBuf],
    expected_identifier: &str,
) -> std::io::Result<PathBuf> {
    let metadata = fs::symlink_metadata(bundle)?;

    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "refusing to act on a symlinked or non-directory application",
        ));
    }

    if bundle.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "refusing to act on a path that is not an .app bundle",
        ));
    }

    let parent = bundle.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "bundle has no parent")
    })?;
    let expected = parent.canonicalize()?.join(
        bundle
            .file_name()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no name"))?,
    );
    let canonical = bundle.canonicalize()?;

    // A symlink swapped in after the scan resolves somewhere else. Comparing
    // against the canonical parent + original name rejects that replacement.
    if canonical != expected {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "refusing to follow a symlinked application",
        ));
    }

    if canonical.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "refusing to act on a path that is not an .app bundle",
        ));
    }

    if canonical.to_string_lossy().starts_with("/System/") || protected_bundle(&canonical) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "refusing to act on a system application",
        ));
    }

    let allowed = allowed_roots.iter().any(|root| {
        root.canonicalize()
            .map(|root| canonical.starts_with(&root) && canonical != root)
            .unwrap_or(false)
    });

    if !allowed {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "application is outside the managed Applications directories",
        ));
    }

    let identifier = bundle_identifier(&canonical).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "bundle has no identifier")
    })?;

    if !identifier.eq_ignore_ascii_case(expected_identifier) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "bundle identifier changed since it was scanned",
        ));
    }

    Ok(canonical)
}

/// Remove one app bundle after proving it is safe. The checks repeat the scan
/// intentionally: a user-writable Applications directory is not trusted.
pub fn remove_bundle(
    bundle: &Path,
    allowed_roots: &[PathBuf],
    expected_identifier: &str,
) -> std::io::Result<()> {
    let canonical = validate_bundle(bundle, allowed_roots, expected_identifier)?;

    fs::remove_dir_all(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::sync::Mutex;
    use tempfile::tempdir;

    fn rule(action: &str, match_type: &str, value: &str) -> InstalledRestrictedSoftware {
        InstalledRestrictedSoftware {
            id: "rule-1".into(),
            name: "Test rule".into(),
            match_type: match_type.into(),
            match_value: value.into(),
            action: action.into(),
            message: None,
            interval_seconds: 300,
            server_url: "https://mattrax.test/api/".into(),
            device_token: "token".into(),
        }
    }

    #[test]
    fn parses_the_delivered_payload() {
        let profile: Value = plist::from_bytes(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.mattrax.restricted-software</string>
<key>RestrictedSoftwareID</key><string>rule-1</string>
<key>MatchType</key><string>bundle-id</string>
<key>MatchValue</key><string>com.example.Banned</string>
<key>Action</key><string>delete-app</string>
<key>Message</key><string>Not allowed</string>
<key>IntervalSeconds</key><integer>120</integer>
<key>ServerURL</key><string>https://mattrax.test/api</string>
<key>DeviceToken</key><string>token</string>
</dict></array>
</dict></plist>"#,
        )
        .expect("profile parses");

        let rules = rules_from_profile(&profile);

        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "rule-1");
        assert_eq!(rules[0].match_type, "bundle-id");
        assert_eq!(rules[0].action, "delete-app");
        assert_eq!(rules[0].interval_seconds, 120);
    }

    #[test]
    fn ignores_actions_the_agent_cannot_perform() {
        let profile: Value = plist::from_bytes(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.mattrax.restricted-software</string>
<key>RestrictedSoftwareID</key><string>rule-1</string>
<key>MatchType</key><string>bundle-id</string>
<key>MatchValue</key><string>com.example.Banned</string>
<key>Action</key><string>block-install</string>
<key>ServerURL</key><string>https://mattrax.test/api</string>
<key>DeviceToken</key><string>token</string>
</dict></array></dict></plist>"#,
        )
        .expect("profile parses");

        assert!(rules_from_profile(&profile).is_empty());
    }

    #[test]
    fn matches_process_names_exactly() {
        let processes = vec![
            (10, "/Applications/Banned.app/Contents/MacOS/Banned".into()),
            (11, "/usr/sbin/BannedHelper".into()),
            (12, "/usr/bin/Allowed".into()),
        ];
        let pids = matching_pids(
            &rule("kill-process", "process-name", "Banned"),
            &processes,
            &[],
        );

        assert_eq!(pids, vec![10]);
    }

    #[test]
    fn matches_processes_inside_a_bundle() {
        let processes = vec![
            (20, "/Applications/Banned.app/Contents/MacOS/Banned".into()),
            (
                21,
                "/Applications/Allowed.app/Contents/MacOS/Allowed".into(),
            ),
        ];
        let bundles = vec![PathBuf::from("/Applications/Banned.app")];
        let pids = matching_pids(
            &rule("kill-process", "bundle-id", "com.example.Banned"),
            &processes,
            &bundles,
        );

        assert_eq!(pids, vec![20]);
    }

    fn write_info_plist(bundle: &Path, identifier: &str) {
        let contents = bundle.join("Contents");
        fs::create_dir_all(&contents).expect("contents");

        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>{identifier}</string>
</dict></plist>"#
        );

        fs::write(contents.join("Info.plist"), plist).expect("info plist");
    }

    #[test]
    fn removes_only_allowed_app_bundles() {
        let directory = tempdir().expect("temp dir");
        let allowed = directory.path().join("Applications");
        let bundle = allowed.join("Banned.app");
        write_info_plist(&bundle, "com.example.Banned");

        remove_bundle(
            &bundle,
            std::slice::from_ref(&allowed),
            "com.example.Banned",
        )
        .expect("bundle removed");
        assert!(!bundle.exists());

        let outside = directory.path().join("Elsewhere.app");
        write_info_plist(&outside, "com.example.Banned");

        assert!(remove_bundle(&outside, &[allowed], "com.example.Banned").is_err());
    }

    #[test]
    fn rejects_a_symlink_swapped_for_an_app_bundle() {
        let directory = tempdir().expect("temp dir");
        let allowed = directory.path().join("Applications");
        let target = allowed.join("Target.app");
        write_info_plist(&target, "com.example.Banned");

        // The scanned path is still called Banned.app, but it is now a symlink
        // to another bundle. A root process must not follow it.
        let link = allowed.join("Banned.app");
        std::os::unix::fs::symlink(&target, &link).expect("symlink");

        assert!(
            remove_bundle(&link, std::slice::from_ref(&allowed), "com.example.Banned",).is_err(),
            "a symlink must be rejected before deletion"
        );
        assert!(target.exists(), "the symlink target must survive");
    }

    #[test]
    fn rejects_a_bundle_whose_identifier_changed() {
        let directory = tempdir().expect("temp dir");
        let allowed = directory.path().join("Applications");
        let bundle = allowed.join("Banned.app");
        write_info_plist(&bundle, "com.example.Other");

        assert!(remove_bundle(&bundle, &[allowed], "com.example.Banned").is_err());
        assert!(bundle.exists());
    }

    #[test]
    fn process_rules_strip_the_app_suffix_and_skip_dangerous_processes() {
        let processes = vec![
            (1, "/sbin/launchd".into()),
            (std::process::id(), "/usr/local/libexec/mattraxd".into()),
            (30, "/Applications/Banned.app/Contents/MacOS/Banned".into()),
            (31, "/usr/libexec/launchd".into()),
        ];

        let pids = matching_pids(
            &rule("kill-process", "process-name", "Banned.app"),
            &processes,
            &[],
        );

        assert_eq!(pids, vec![30]);
    }

    struct FakeProcesses {
        present: Mutex<Vec<u32>>,
        term_result: KillFailure,
        kill_result: KillFailure,
        ignore_term: bool,
    }

    impl ProcessControl for FakeProcesses {
        fn signal(&self, pid: u32, signal: i32) -> Result<(), KillFailure> {
            if !self.present.lock().unwrap().contains(&pid) {
                return Err(KillFailure::Gone);
            }

            if signal == libc::SIGKILL {
                if self.kill_result == KillFailure::Gone {
                    self.present.lock().unwrap().retain(|value| *value != pid);
                    return Ok(());
                }

                return Err(self.kill_result);
            }

            if self.ignore_term {
                return Ok(());
            }

            if self.term_result == KillFailure::Gone {
                self.present.lock().unwrap().retain(|value| *value != pid);
                return Ok(());
            }

            Err(self.term_result)
        }

        fn exists(&self, pid: u32) -> bool {
            self.present.lock().unwrap().contains(&pid)
        }
    }

    #[test]
    fn termination_reports_permission_denied_instead_of_success() {
        let control = FakeProcesses {
            present: Mutex::new(vec![42]),
            term_result: KillFailure::Permission,
            kill_result: KillFailure::Permission,
            ignore_term: false,
        };

        let (stopped, error) = terminate_with(vec![42], &control, 0);

        assert_eq!(stopped, 0);
        assert!(error.unwrap().contains("denied"));
    }

    #[test]
    fn termination_escalates_and_fails_when_a_process_survives() {
        let control = FakeProcesses {
            present: Mutex::new(vec![43]),
            term_result: KillFailure::Failed(0),
            kill_result: KillFailure::Failed(0),
            ignore_term: false,
        };

        let (stopped, error) = terminate_with(vec![43], &control, 0);

        assert_eq!(stopped, 0);
        assert!(error.unwrap().contains("still running"));
    }

    #[test]
    fn termination_counts_processes_killed_by_sigkill() {
        let control = FakeProcesses {
            present: Mutex::new(vec![44]),
            term_result: KillFailure::Failed(0),
            kill_result: KillFailure::Gone,
            ignore_term: true,
        };

        let (stopped, error) = terminate_with(vec![44], &control, 0);

        assert_eq!(stopped, 1);
        assert!(error.is_none());
    }

    struct FakeCommandProcesses {
        present: Mutex<Vec<u32>>,
        commands: Mutex<Vec<(u32, String)>>,
        signals: Mutex<Vec<(u32, i32)>>,
    }

    impl ProcessControl for FakeCommandProcesses {
        fn signal(&self, pid: u32, signal: i32) -> Result<(), KillFailure> {
            self.signals.lock().unwrap().push((pid, signal));
            if signal == libc::SIGTERM {
                self.present.lock().unwrap().retain(|value| *value != pid);
            }
            Ok(())
        }

        fn exists(&self, pid: u32) -> bool {
            self.present.lock().unwrap().contains(&pid)
        }

        fn command(&self, pid: u32) -> Option<String> {
            self.commands
                .lock()
                .unwrap()
                .iter()
                .find(|(candidate, _)| *candidate == pid)
                .map(|(_, command)| command.clone())
        }
    }

    fn empty_snapshot() -> EnforcementSnapshot {
        EnforcementSnapshot {
            processes: Ok(Vec::new()),
            bundles: Vec::new(),
            allowed_roots: Vec::new(),
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn live_process_control_reads_the_current_executable_without_spawning_ps() {
        let command = LiveProcessControl
            .command(std::process::id())
            .expect("current executable path");

        assert!(Path::new(&command).is_absolute());
    }

    #[test]
    fn shared_snapshots_never_signal_a_dangerous_recycled_pid() {
        let control = FakeCommandProcesses {
            present: Mutex::new(vec![42]),
            commands: Mutex::new(vec![(42, "/sbin/launchd".into())]),
            signals: Mutex::new(Vec::new()),
        };
        let rule = rule("kill-process", "process-name", "Banned");
        let snapshot = empty_snapshot();

        let (stopped, error) = terminate_matches_with(
            vec![(42, "/usr/bin/Banned".into())],
            &rule,
            &snapshot,
            &control,
            0,
        );

        assert_eq!(stopped, 0);
        assert!(error.is_none());
        assert!(control.signals.lock().unwrap().is_empty());
    }

    #[test]
    fn shared_snapshots_recheck_identity_again_before_sending_a_signal() {
        struct ChangesAfterSnapshot {
            present: Mutex<Vec<u32>>,
            reads: Mutex<usize>,
            signals: Mutex<Vec<(u32, i32)>>,
        }

        impl ProcessControl for ChangesAfterSnapshot {
            fn signal(&self, pid: u32, signal: i32) -> Result<(), KillFailure> {
                self.signals.lock().unwrap().push((pid, signal));
                Ok(())
            }

            fn exists(&self, pid: u32) -> bool {
                self.present.lock().unwrap().contains(&pid)
            }

            fn command(&self, _pid: u32) -> Option<String> {
                let mut reads = self.reads.lock().unwrap();
                *reads += 1;
                Some(if *reads <= 2 {
                    "/usr/bin/Banned".into()
                } else {
                    "/sbin/launchd".into()
                })
            }
        }

        let control = ChangesAfterSnapshot {
            present: Mutex::new(vec![42]),
            reads: Mutex::new(0),
            signals: Mutex::new(Vec::new()),
        };
        let rule = rule("kill-process", "process-name", "Banned");
        let snapshot = empty_snapshot();

        let (_, error) = terminate_matches_with(
            vec![(42, "/usr/bin/Banned".into())],
            &rule,
            &snapshot,
            &control,
            0,
        );

        assert!(error.is_none());
        assert!(control.signals.lock().unwrap().is_empty());
    }

    #[test]
    fn shared_snapshots_still_terminate_a_matching_process() {
        let control = FakeCommandProcesses {
            present: Mutex::new(vec![43]),
            commands: Mutex::new(vec![(43, "/usr/bin/Banned".into())]),
            signals: Mutex::new(Vec::new()),
        };
        let rule = rule("kill-process", "process-name", "Banned");
        let snapshot = empty_snapshot();

        let (stopped, error) = terminate_matches_with(
            vec![(43, "/usr/bin/Banned".into())],
            &rule,
            &snapshot,
            &control,
            0,
        );

        assert_eq!(stopped, 1);
        assert!(error.is_none());
        assert_eq!(*control.signals.lock().unwrap(), vec![(43, libc::SIGTERM)]);
    }

    #[test]
    fn post_is_deduplicated_per_rule_and_interval() {
        struct Recorder {
            runs: Mutex<Vec<String>>,
            posted: Mutex<usize>,
            snapshots: Mutex<Vec<bool>>,
        }

        impl RestrictedRunner for Recorder {
            fn snapshot(&self, include_bundles: bool) -> EnforcementSnapshot {
                self.snapshots.lock().unwrap().push(include_bundles);
                EnforcementSnapshot {
                    processes: Ok(Vec::new()),
                    bundles: Vec::new(),
                    allowed_roots: Vec::new(),
                }
            }

            fn enforce(
                &self,
                rule: &InstalledRestrictedSoftware,
                _snapshot: &EnforcementSnapshot,
            ) -> RestrictedResult {
                self.runs.lock().unwrap().push(rule.id.clone());
                RestrictedResult::succeeded(rule, 1, 0, "killed".into())
            }

            fn post(
                &self,
                _rule: &InstalledRestrictedSoftware,
                _result: &RestrictedResult,
                _logger: &Logger,
            ) {
                *self.posted.lock().unwrap() += 1;
            }
        }

        let recorder = Recorder {
            runs: Mutex::new(Vec::new()),
            posted: Mutex::new(0),
            snapshots: Mutex::new(Vec::new()),
        };
        let mut state = BTreeMap::new();
        let at = Local.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap();
        let rules = [rule("kill-process", "process-name", "Banned")];

        tick(&rules, &mut state, at, &recorder, &Logger::system());
        tick(&rules, &mut state, at, &recorder, &Logger::system());

        assert_eq!(*recorder.runs.lock().unwrap(), vec!["rule-1"]);
        assert_eq!(*recorder.posted.lock().unwrap(), 1);
        assert_eq!(*recorder.snapshots.lock().unwrap(), vec![false]);
    }

    #[test]
    fn all_due_rules_share_one_process_and_bundle_snapshot() {
        struct Recorder {
            runs: Mutex<Vec<String>>,
            snapshots: Mutex<Vec<bool>>,
        }

        impl RestrictedRunner for Recorder {
            fn snapshot(&self, include_bundles: bool) -> EnforcementSnapshot {
                self.snapshots.lock().unwrap().push(include_bundles);
                EnforcementSnapshot {
                    processes: Ok(Vec::new()),
                    bundles: Vec::new(),
                    allowed_roots: Vec::new(),
                }
            }

            fn enforce(
                &self,
                rule: &InstalledRestrictedSoftware,
                _snapshot: &EnforcementSnapshot,
            ) -> RestrictedResult {
                self.runs.lock().unwrap().push(rule.id.clone());
                RestrictedResult::succeeded(rule, 0, 0, "no match".into())
            }

            fn post(
                &self,
                _rule: &InstalledRestrictedSoftware,
                _result: &RestrictedResult,
                _logger: &Logger,
            ) {
                panic!("no-op results must not be posted");
            }
        }

        let recorder = Recorder {
            runs: Mutex::new(Vec::new()),
            snapshots: Mutex::new(Vec::new()),
        };
        let rules = [
            rule("kill-process", "process-name", "Banned"),
            rule("delete-app", "bundle-id", "com.example.Banned"),
            rule("kill-process", "bundle-id", "com.example.Other"),
        ]
        .into_iter()
        .enumerate()
        .map(|(index, mut rule)| {
            rule.id = format!("rule-{index}");
            rule
        })
        .collect::<Vec<_>>();
        let at = Local.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap();

        tick(
            &rules,
            &mut BTreeMap::new(),
            at,
            &recorder,
            &Logger::system(),
        );

        assert_eq!(
            *recorder.runs.lock().unwrap(),
            rules.iter().map(|rule| rule.id.clone()).collect::<Vec<_>>()
        );
        assert_eq!(*recorder.snapshots.lock().unwrap(), vec![true]);
    }

    #[test]
    fn shared_bundle_snapshots_keep_scope_symlink_and_apple_protections() {
        let directory = tempdir().expect("temp dir");
        let allowed = directory.path().join("Applications");
        let safe = allowed.join("Safe.app");
        let apple = allowed.join("Apple.app");
        let outside = directory.path().join("Outside.app");
        write_info_plist(&safe, "com.example.Banned");
        write_info_plist(&apple, "com.apple.Banned");
        write_info_plist(&outside, "com.example.Banned");

        let link = allowed.join("Link.app");
        std::os::unix::fs::symlink(&safe, &link).expect("symlink");
        let snapshot = EnforcementSnapshot {
            processes: Ok(Vec::new()),
            bundles: vec![
                BundleSnapshot {
                    path: safe.clone(),
                    identifier: "com.example.Banned".into(),
                },
                BundleSnapshot {
                    path: link,
                    identifier: "com.example.Banned".into(),
                },
                BundleSnapshot {
                    path: apple,
                    identifier: "com.apple.Banned".into(),
                },
                BundleSnapshot {
                    path: outside,
                    identifier: "com.example.Banned".into(),
                },
            ],
            allowed_roots: vec![allowed],
        };

        assert_eq!(
            bundles_for_rule(
                &rule("delete-app", "bundle-id", "com.example.Banned"),
                &snapshot,
            ),
            vec![safe]
        );
    }

    #[test]
    fn endpoint_trims_the_api_suffix() {
        assert_eq!(
            endpoint_for("https://mattrax.test/api/"),
            "https://mattrax.test/api/v1/restricted-software-agent/results"
        );
    }

    #[test]
    fn serialises_the_result_contract() {
        let result = RestrictedResult {
            rule_id: "rule-1".into(),
            action: "delete-app".into(),
            status: "succeeded".into(),
            detail: Some("removed".into()),
            killed_processes: 2,
            removed_applications: 1,
            occurred_at: "2026-11-20T12:00:00Z".into(),
        };

        let json = serde_json::to_value(&result).expect("result serialises");

        assert_eq!(json["ruleId"], "rule-1");
        assert_eq!(json["killedProcesses"], 2);
        assert_eq!(json["removedApplications"], 1);
    }
}
