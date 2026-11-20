//! The script-agent result contract.
//!
//! One terminal result per run, posted to
//! `POST <ServerURL>/v1/script-agent/results` with the device bearer token.
//! `curl` is used exactly as the Swift agent did, so proxy and TLS behaviour
//! follows the host configuration and no TLS stack is linked into the daemon.

use crate::logging::Logger;
use crate::profiles::InstalledScript;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};

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
}
