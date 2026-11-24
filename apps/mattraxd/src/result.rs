//! Agent result contracts and restricted-result delivery.
//!
//! One terminal result per run, posted to
//! `POST <ServerURL>/v1/script-agent/results` with the device bearer token.
//! `curl` is used exactly as the Swift agent did, so proxy and TLS behaviour
//! follows the host configuration and no TLS stack is linked into the daemon.
//! Restricted-software results use a persisted queue and one bounded worker so
//! network failures cannot stall local enforcement.

use crate::logging::Logger;
use crate::profiles::InstalledScript;
use crate::restricted::{
    endpoint_for as restricted_endpoint_for, InstalledRestrictedSoftware, RestrictedResult,
};
use crate::state;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub run_id: String,
    pub script_id: String,
    pub trigger: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,

    pub stdout: String,
    pub stderr: String,
    pub duration_ms: i64,
    pub started_at: String,
    pub finished_at: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,

    pub timed_out: bool,
}

pub fn endpoint_for(server_url: &str) -> String {
    format!("{}/v1/script-agent/results", server_url.trim_matches('/'))
}

const MAX_PENDING_RESTRICTED_RESULTS: usize = 256;
const RESTRICTED_CONNECT_TIMEOUT_SECONDS: u64 = 2;
const RESTRICTED_TOTAL_TIMEOUT_SECONDS: u64 = 5;
const RETRY_BASE_SECONDS: u64 = 5;
const RETRY_MAX_SECONDS: u64 = 900;
const WORKER_POLL_INTERVAL: Duration = Duration::from_secs(1);
static NEXT_RESULT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingRestrictedResult {
    id: String,
    server_url: String,
    device_token: String,
    result: RestrictedResult,
    queued_at: i64,
    attempts: u32,
    next_attempt_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PendingRestrictedResults {
    entries: VecDeque<PendingRestrictedResult>,
}

pub(crate) trait RestrictedResultSender: Send + Sync {
    fn send(
        &self,
        result: &RestrictedResult,
        server_url: &str,
        device_token: &str,
    ) -> Result<(), String>;
}

pub(crate) struct CurlRestrictedResultSender;

impl RestrictedResultSender for CurlRestrictedResultSender {
    fn send(
        &self,
        result: &RestrictedResult,
        server_url: &str,
        device_token: &str,
    ) -> Result<(), String> {
        let data = serde_json::to_vec(result)
            .map_err(|error| format!("could not encode result: {error}"))?;
        let arguments = restricted_curl_arguments(server_url, device_token);
        let mut child = Command::new(curl())
            .args(&arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("could not start curl: {error}"))?;

        let write_result = child
            .stdin
            .take()
            .map(|mut stdin| stdin.write_all(&data))
            .transpose();
        let output = child
            .wait_with_output()
            .map_err(|error| format!("could not wait for curl: {error}"))?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "curl exited {}: {}",
                output.status.code().unwrap_or(-1),
                detail.chars().take(DETAIL_LIMIT).collect::<String>().trim()
            ));
        }

        write_result
            .map(|_| ())
            .map_err(|error| format!("could not send result: {error}"))
    }
}

const DETAIL_LIMIT: usize = 500;

fn restricted_curl_arguments(server_url: &str, device_token: &str) -> Vec<String> {
    [
        "--fail",
        "--silent",
        "--show-error",
        "--connect-timeout",
        &RESTRICTED_CONNECT_TIMEOUT_SECONDS.to_string(),
        "--max-time",
        &RESTRICTED_TOTAL_TIMEOUT_SECONDS.to_string(),
        "-X",
        "POST",
        "-H",
        "content-type: application/json",
        "-H",
        &format!("authorization: Bearer {device_token}"),
        "--data-binary",
        "@-",
        &restricted_endpoint_for(server_url),
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

/// A single network worker drains persisted enforcement results. Enqueueing
/// never performs network I/O, so an endpoint outage cannot delay later rules.
#[derive(Clone)]
pub struct RestrictedResultQueue {
    path: PathBuf,
    logger: Arc<Logger>,
    pending: Arc<Mutex<PendingRestrictedResults>>,
    sender: Arc<dyn RestrictedResultSender>,
}

impl RestrictedResultQueue {
    pub fn system(state_path: &Path) -> Self {
        Self::new(
            result_queue_path(state_path),
            Logger::system(),
            Arc::new(CurlRestrictedResultSender),
        )
    }

    pub(crate) fn new(
        path: PathBuf,
        logger: Logger,
        sender: Arc<dyn RestrictedResultSender>,
    ) -> Self {
        let pending = if path.exists() {
            match fs::read(&path)
                .map_err(|error| error.to_string())
                .and_then(|data| {
                    serde_json::from_slice::<PendingRestrictedResults>(&data)
                        .map_err(|error| error.to_string())
                }) {
                Ok(pending) => pending,
                Err(error) => {
                    logger.log(format!(
                        "could not load restricted result queue; starting empty: {error}"
                    ));
                    PendingRestrictedResults::default()
                }
            }
        } else {
            PendingRestrictedResults::default()
        };

        let mut pending = pending;
        if pending.entries.len() > MAX_PENDING_RESTRICTED_RESULTS {
            let overflow = pending.entries.len() - MAX_PENDING_RESTRICTED_RESULTS;
            pending.entries.drain(..overflow);
        }

        Self {
            path,
            logger: Arc::new(logger),
            pending: Arc::new(Mutex::new(pending)),
            sender,
        }
    }

    pub(crate) fn enqueue(&self, rule: &InstalledRestrictedSoftware, result: &RestrictedResult) {
        let now = unix_timestamp();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let pending = PendingRestrictedResult {
            id: format!(
                "{}-{nonce}-{}",
                std::process::id(),
                NEXT_RESULT_ID.fetch_add(1, Ordering::Relaxed)
            ),
            server_url: rule.server_url.clone(),
            device_token: rule.device_token.clone(),
            result: result.clone(),
            queued_at: now,
            attempts: 0,
            next_attempt_at: now,
        };
        let mut state = self.lock_pending();

        if state.entries.len() >= MAX_PENDING_RESTRICTED_RESULTS {
            state.entries.pop_front();
            self.logger.log(format!(
                "restricted result queue full; dropped oldest of {MAX_PENDING_RESTRICTED_RESULTS} results"
            ));
        }

        state.entries.push_back(pending);
        self.persist(&state);
    }

    #[cfg(test)]
    pub(crate) fn pending_len(&self) -> usize {
        self.lock_pending().entries.len()
    }

    pub(crate) fn start_worker(&self) -> RestrictedResultWorker {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let queue = self.clone();
        let thread = thread::spawn(move || {
            while !worker_stop.load(Ordering::Acquire) {
                let delay = queue.deliver_due(unix_timestamp());
                thread::sleep(delay);
            }
        });

        RestrictedResultWorker {
            stop,
            thread: Some(thread),
        }
    }

    fn deliver_due(&self, now: i64) -> Duration {
        let next = {
            let state = self.lock_pending();
            state
                .entries
                .iter()
                .find(|entry| entry.next_attempt_at <= now)
                .cloned()
        };

        let Some(next) = next else {
            return self.next_poll_delay(now);
        };

        let outcome = self
            .sender
            .send(&next.result, &next.server_url, &next.device_token);
        let finished_at = unix_timestamp().max(now);
        let mut state = self.lock_pending();
        let Some(index) = state.entries.iter().position(|entry| entry.id == next.id) else {
            drop(state);
            return self.next_poll_delay(finished_at);
        };

        match outcome {
            Ok(()) => {
                state.entries.remove(index);
                self.persist(&state);
            }
            Err(error) => {
                let entry = &mut state.entries[index];
                entry.attempts = entry.attempts.saturating_add(1);
                let delay = retry_delay_seconds(entry.attempts);
                entry.next_attempt_at = finished_at.saturating_add(delay as i64);
                self.logger.log(format!(
                    "restricted result for {} failed (attempt {}); retrying in {delay}s: {error}",
                    next.result.rule_id, entry.attempts
                ));
                self.persist(&state);
            }
        }

        drop(state);
        self.next_poll_delay(finished_at)
    }

    fn next_poll_delay(&self, now: i64) -> Duration {
        let state = self.lock_pending();
        let delay = state
            .entries
            .iter()
            .map(|entry| entry.next_attempt_at.saturating_sub(now).max(0) as u64)
            .min()
            .map(Duration::from_secs)
            .unwrap_or(WORKER_POLL_INTERVAL);

        delay.min(WORKER_POLL_INTERVAL)
    }

    fn lock_pending(&self) -> std::sync::MutexGuard<'_, PendingRestrictedResults> {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn persist(&self, state: &PendingRestrictedResults) {
        if let Err(error) = state::save_json(&self.path, state) {
            self.logger.log(format!(
                "could not persist restricted result queue: {error}"
            ));
        }
    }
}

pub struct RestrictedResultWorker {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Drop for RestrictedResultWorker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn result_queue_path(state_path: &Path) -> PathBuf {
    state_path.with_file_name("restricted-results.json")
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn retry_delay_seconds(attempts: u32) -> u64 {
    let exponent = attempts.saturating_sub(1).min(16);
    RETRY_BASE_SECONDS
        .saturating_mul(1_u64 << exponent)
        .min(RETRY_MAX_SECONDS)
}

/// Post one result. Failures are logged, never retried: the daemon's next tick
/// is more valuable than replaying a terminal run.
pub fn post(script: &InstalledScript, result: &ScriptResult, logger: &Logger) {
    let data = match serde_json::to_vec(result) {
        Ok(data) => data,
        Err(error) => {
            logger.log(format!("result post could not encode: {error}"));
            return;
        }
    };

    let mut child = match Command::new(curl())
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "30",
            "-X",
            "POST",
            "-H",
            "content-type: application/json",
            "-H",
            &format!("authorization: Bearer {}", script.device_token),
            "--data-binary",
            "@-",
            &endpoint_for(&script.server_url),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            logger.log(format!("result post could not start: {error}"));
            return;
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(&data) {
            logger.log(format!("result post could not send: {error}"));
        }
    }

    match child.wait_with_output() {
        Ok(output) => {
            if !output.status.success() {
                let response = String::from_utf8_lossy(&output.stderr);
                logger.log(format!(
                    "result post failed ({}): {}",
                    output.status.code().unwrap_or(-1),
                    response.trim()
                ));
            }
        }
        Err(error) => logger.log(format!("result post failed: {error}")),
    }
}

#[cfg(target_os = "macos")]
fn curl() -> &'static str {
    "/usr/bin/curl"
}

#[cfg(not(target_os = "macos"))]
fn curl() -> &'static str {
    "curl"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_trims_slashes_like_the_swift_agent() {
        assert_eq!(
            endpoint_for("https://mattrax.test/"),
            "https://mattrax.test/v1/script-agent/results"
        );
        assert_eq!(
            endpoint_for("https://mattrax.test///"),
            "https://mattrax.test/v1/script-agent/results"
        );
        assert_eq!(
            endpoint_for("https://mattrax.test/api/"),
            "https://mattrax.test/api/v1/script-agent/results"
        );
    }

    #[test]
    fn serialises_the_documented_result_contract() {
        let result = ScriptResult {
            run_id: "run-1".into(),
            script_id: "script-1".into(),
            trigger: "manual".into(),
            exit_code: Some(0),
            stdout: "hi".into(),
            stderr: String::new(),
            duration_ms: 42,
            started_at: "2026-11-16T12:00:00Z".into(),
            finished_at: "2026-11-16T12:00:00Z".into(),
            detail: None,
            timed_out: false,
        };

        let json = serde_json::to_value(&result).expect("result serialises");

        assert_eq!(json["runId"], "run-1");
        assert_eq!(json["scriptId"], "script-1");
        assert_eq!(json["exitCode"], 0);
        assert_eq!(json["durationMs"], 42);
        assert_eq!(json["timedOut"], false);
        // Swift omitted nil optionals; keep the wire shape identical.
        assert!(json.get("detail").is_none());
    }

    #[test]
    fn exits_without_a_code_omit_exit_code() {
        let result = ScriptResult {
            run_id: "run-1".into(),
            script_id: "script-1".into(),
            trigger: "install".into(),
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            started_at: "2026-11-16T12:00:00Z".into(),
            finished_at: "2026-11-16T12:00:00Z".into(),
            detail: Some("skipped".into()),
            timed_out: false,
        };

        let json = serde_json::to_value(&result).expect("result serialises");

        assert!(json.get("exitCode").is_none());
        assert_eq!(json["detail"], "skipped");
    }

    #[derive(Clone, Default)]
    struct RecordingSender {
        calls: Arc<Mutex<Vec<String>>>,
        outcomes: Arc<Mutex<VecDeque<Result<(), String>>>>,
    }

    impl RestrictedResultSender for RecordingSender {
        fn send(
            &self,
            result: &RestrictedResult,
            _server_url: &str,
            _device_token: &str,
        ) -> Result<(), String> {
            self.calls.lock().unwrap().push(result.rule_id.clone());
            self.outcomes.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }
    }

    fn restricted_rule(id: &str) -> InstalledRestrictedSoftware {
        InstalledRestrictedSoftware {
            id: id.into(),
            name: "Test rule".into(),
            match_type: "process-name".into(),
            match_value: "Banned".into(),
            action: "kill-process".into(),
            message: None,
            interval_seconds: 300,
            server_url: "https://mattrax.test/api/".into(),
            device_token: "device-token".into(),
        }
    }

    fn restricted_result(rule: &InstalledRestrictedSoftware) -> RestrictedResult {
        RestrictedResult {
            rule_id: rule.id.clone(),
            action: rule.action.clone(),
            status: "succeeded".into(),
            detail: Some("killed".into()),
            killed_processes: 1,
            removed_applications: 0,
            occurred_at: "2026-11-20T12:00:00Z".into(),
        }
    }

    fn test_queue(path: PathBuf, sender: Arc<dyn RestrictedResultSender>) -> RestrictedResultQueue {
        RestrictedResultQueue::new(path, Logger::stderr_only(), sender)
    }

    #[test]
    fn queued_results_survive_a_restart_and_enqueue_never_sends() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("restricted-results.json");
        let sender = Arc::new(RecordingSender::default());
        let rule = restricted_rule("rule-1");
        let result = restricted_result(&rule);
        let first = test_queue(path.clone(), sender.clone());

        first.enqueue(&rule, &result);

        assert!(sender.calls.lock().unwrap().is_empty());
        assert_eq!(first.pending_len(), 1);
        drop(first);

        let restarted = test_queue(path.clone(), sender.clone());
        assert_eq!(restarted.pending_len(), 1);
        restarted.deliver_due(unix_timestamp());

        assert_eq!(*sender.calls.lock().unwrap(), vec!["rule-1"]);
        assert_eq!(restarted.pending_len(), 0);
        drop(restarted);
        assert_eq!(test_queue(path, sender).pending_len(), 0);
    }

    #[test]
    fn failed_delivery_persists_backoff_and_retries_when_due() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("restricted-results.json");
        let sender = Arc::new(RecordingSender {
            outcomes: Arc::new(Mutex::new(VecDeque::from([Err("offline".into()), Ok(())]))),
            ..RecordingSender::default()
        });
        let rule = restricted_rule("rule-1");
        let queue = test_queue(path.clone(), sender.clone());
        queue.enqueue(&rule, &restricted_result(&rule));
        let now = unix_timestamp() + 10;

        queue.deliver_due(now);
        assert_eq!(queue.pending_len(), 1);
        assert_eq!(sender.calls.lock().unwrap().len(), 1);

        let restarted = test_queue(path, sender.clone());
        restarted.deliver_due(now + retry_delay_seconds(1) as i64 - 1);
        assert_eq!(sender.calls.lock().unwrap().len(), 1);

        restarted.deliver_due(now + retry_delay_seconds(1) as i64);
        assert_eq!(sender.calls.lock().unwrap().len(), 2);
        assert_eq!(restarted.pending_len(), 0);
    }

    #[test]
    fn a_backed_off_result_does_not_block_other_due_results() {
        struct FirstFails {
            calls: Mutex<Vec<String>>,
        }

        impl RestrictedResultSender for FirstFails {
            fn send(
                &self,
                result: &RestrictedResult,
                _server_url: &str,
                _device_token: &str,
            ) -> Result<(), String> {
                self.calls.lock().unwrap().push(result.rule_id.clone());
                if result.rule_id == "rule-1" {
                    Err("offline".into())
                } else {
                    Ok(())
                }
            }
        }

        let directory = tempfile::tempdir().expect("temp dir");
        let sender = Arc::new(FirstFails {
            calls: Mutex::new(Vec::new()),
        });
        let queue = test_queue(
            directory.path().join("restricted-results.json"),
            sender.clone(),
        );
        let first = restricted_rule("rule-1");
        let second = restricted_rule("rule-2");
        queue.enqueue(&first, &restricted_result(&first));
        queue.enqueue(&second, &restricted_result(&second));
        let now = unix_timestamp() + 10;

        queue.deliver_due(now);
        queue.deliver_due(now);

        assert_eq!(*sender.calls.lock().unwrap(), vec!["rule-1", "rule-2"]);
        assert_eq!(queue.pending_len(), 1);
    }

    #[test]
    fn the_persistent_queue_is_bounded_and_private() {
        let directory = tempfile::tempdir().expect("temp dir");
        let path = directory.path().join("restricted-results.json");
        let sender = Arc::new(RecordingSender::default());
        let queue = test_queue(path.clone(), sender);

        for index in 0..=MAX_PENDING_RESTRICTED_RESULTS {
            let rule = restricted_rule(&format!("rule-{index}"));
            queue.enqueue(&rule, &restricted_result(&rule));
        }

        assert_eq!(queue.pending_len(), MAX_PENDING_RESTRICTED_RESULTS);
        let persisted: PendingRestrictedResults = state::load_json(&path);
        assert_eq!(persisted.entries.len(), MAX_PENDING_RESTRICTED_RESULTS);
        assert_eq!(persisted.entries[0].result.rule_id, "rule-1");
        assert_eq!(
            persisted
                .entries
                .back()
                .expect("newest result")
                .result
                .rule_id,
            format!("rule-{}", MAX_PENDING_RESTRICTED_RESULTS)
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn restricted_delivery_uses_short_connect_and_total_timeouts() {
        let arguments = restricted_curl_arguments("https://mattrax.test/api/", "token");
        let value = |flag: &str| {
            arguments
                .iter()
                .position(|argument| argument == flag)
                .map(|index| arguments[index + 1].as_str())
        };

        assert_eq!(value("--connect-timeout"), Some("2"));
        assert_eq!(value("--max-time"), Some("5"));
        assert!(arguments.contains(&"authorization: Bearer token".to_owned()));
        assert!(arguments
            .contains(&"https://mattrax.test/api/v1/restricted-software-agent/results".to_owned()));
    }

    #[test]
    fn the_background_worker_delivers_queued_results() {
        struct NotifyingSender {
            sent: Mutex<Option<std::sync::mpsc::Sender<()>>>,
        }

        impl RestrictedResultSender for NotifyingSender {
            fn send(
                &self,
                _result: &RestrictedResult,
                _server_url: &str,
                _device_token: &str,
            ) -> Result<(), String> {
                if let Some(sender) = self.sent.lock().unwrap().take() {
                    let _ = sender.send(());
                }
                Ok(())
            }
        }

        let directory = tempfile::tempdir().expect("temp dir");
        let (sender, delivered) = std::sync::mpsc::channel();
        let queue = test_queue(
            directory.path().join("restricted-results.json"),
            Arc::new(NotifyingSender {
                sent: Mutex::new(Some(sender)),
            }),
        );
        let worker = queue.start_worker();
        let rule = restricted_rule("rule-1");

        queue.enqueue(&rule, &restricted_result(&rule));

        delivered
            .recv_timeout(Duration::from_secs(2))
            .expect("worker delivers without waiting for another tick");
        drop(worker);
        assert_eq!(queue.pending_len(), 0);
    }

    #[test]
    fn retry_backoff_is_exponential_and_capped() {
        assert_eq!(retry_delay_seconds(1), 5);
        assert_eq!(retry_delay_seconds(2), 10);
        assert_eq!(retry_delay_seconds(3), 20);
        assert_eq!(retry_delay_seconds(9), 900);
        assert_eq!(retry_delay_seconds(u32::MAX), 900);
    }
}
