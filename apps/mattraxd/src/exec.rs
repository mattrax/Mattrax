//! Running a script body with a timeout, capped capture and output redaction.

use crate::host;
use crate::profiles::InstalledScript;
use crate::result::ScriptResult;
use chrono::{SecondsFormat, Utc};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::Read;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// How long a SIGTERM is given before the process group is killed outright.
/// Swift waited forever; a stuck script must not wedge the daemon.
const TERMINATE_GRACE: Duration = Duration::from_secs(5);

pub const TIMEOUT_DETAIL: &str = "The script exceeded its timeout and was stopped.";
pub const NOT_ROOT_DETAIL: &str = "The agent is not running as root, so a root script cannot run.";
pub const NO_CONSOLE_USER_DETAIL: &str =
    "No console user is logged in, so a user script cannot run.";

#[cfg(unix)]
const SHELLS: &[&str] = &["bash", "zsh", "sh"];
#[cfg(not(unix))]
const SHELLS: &[&str] = &["pwsh"];

/// Capped UTF-8 text. The marker is only added when bytes were dropped.
pub fn capped(data: &[u8]) -> (String, bool) {
    if data.len() <= crate::OUTPUT_LIMIT {
        return (String::from_utf8_lossy(data).into_owned(), false);
    }

    (
        format!(
            "{}{}",
            String::from_utf8_lossy(&data[..crate::OUTPUT_LIMIT]),
            crate::OUTPUT_TRUNCATED_MARKER
        ),
        true,
    )
}

/// Replace every non-empty secret value with `[redacted]`.
pub fn redact(value: &str, secrets: &[String]) -> String {
    let mut text = value.to_owned();

    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        text = text.replace(secret.as_str(), "[redacted]");
    }

    text
}

/// Environment for the child: the daemon's own environment, then the script's
/// entries, then the two Mattrax markers. A script can override `PATH`, which
/// is why this is built explicitly rather than appended in place.
pub fn child_environment(
    script: &InstalledScript,
    trigger: &str,
    base: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    let mut environment: BTreeMap<OsString, OsString> = base.into_iter().collect();

    for entry in &script.environment {
        environment.insert(OsString::from(&entry.name), OsString::from(&entry.value));
    }

    environment.insert(
        OsString::from("MATTRAX_TRIGGER_TYPE"),
        OsString::from(trigger),
    );
    environment.insert(
        OsString::from("MATTRAX_SCRIPT_ID"),
        OsString::from(&script.id),
    );

    environment.into_iter().collect()
}

/// The program and arguments for a body. A user-context script goes through
/// `launchctl asuser` so it runs in the logged-in session, with that user's
/// launchd context rather than the daemon's.
pub fn shell_invocation(
    language: &str,
    body: &str,
    run_as: &str,
    console_uid: Option<u32>,
) -> Result<(String, Vec<String>), &'static str> {
    if !SHELLS.contains(&language) {
        return Err("unsupported language");
    }

    #[cfg(unix)]
    {
        let shell = format!("/bin/{language}");

        if run_as == "root" {
            Ok((shell, vec!["-c".into(), body.into()]))
        } else {
            let uid = console_uid.ok_or("no console user")?;

            Ok((
                "/bin/launchctl".into(),
                vec![
                    "asuser".into(),
                    uid.to_string(),
                    shell,
                    "-c".into(),
                    body.into(),
                ],
            ))
        }
    }

    #[cfg(not(unix))]
    {
        let _ = (run_as, console_uid);

        Ok((
            "pwsh".into(),
            vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                body.into(),
            ],
        ))
    }
}

pub fn execute(script: &InstalledScript, trigger: &str) -> ScriptResult {
    let started = Utc::now();
    let started_instant = Instant::now();
    let run_id = script
        .run_id
        .clone()
        .unwrap_or_else(|| format!("trigger-{}", crate::util::random_hex(8)));
    let secrets: Vec<String> = script
        .environment
        .iter()
        .filter(|entry| entry.secret)
        .map(|entry| entry.value.clone())
        .collect();

    let skipped = |detail: String| ScriptResult {
        run_id: run_id.clone(),
        script_id: script.id.clone(),
        trigger: trigger.to_owned(),
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        duration_ms: 0,
        started_at: iso(started),
        finished_at: iso(Utc::now()),
        detail: Some(detail),
        timed_out: false,
    };

    if script.run_as == "root" && !host::is_elevated() {
        return skipped(NOT_ROOT_DETAIL.to_owned());
    }

    let console = if script.run_as == "root" {
        None
    } else {
        let user = host::console_user();

        if user.is_empty() {
            return skipped(NO_CONSOLE_USER_DETAIL.to_owned());
        }

        match host::console_uid(&user) {
            Some(uid) => Some(uid),
            None => return skipped(NO_CONSOLE_USER_DETAIL.to_owned()),
        }
    };

    let (program, arguments) =
        match shell_invocation(&script.language, &script.body, &script.run_as, console) {
            Ok(invocation) => invocation,
            Err("unsupported language") => {
                return skipped(format!(
                    "The agent cannot run '{}' scripts; use {}.",
                    script.language,
                    shell_list()
                ));
            }
            Err(_) => return skipped(NO_CONSOLE_USER_DETAIL.to_owned()),
        };

    let mut command = Command::new(&program);
    command
        .args(&arguments)
        .env_clear()
        .envs(child_environment(
            script,
            trigger,
            std::env::vars_os().collect::<Vec<_>>(),
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return skipped(format!("The shell could not be started: {error}"));
        }
    };

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_reader = stdout_pipe.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut data = Vec::new();
            let _ = pipe.read_to_end(&mut data);
            data
        })
    });
    let stderr_reader = stderr_pipe.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut data = Vec::new();
            let _ = pipe.read_to_end(&mut data);
            data
        })
    });

    let timed_out = wait_with_timeout(
        &mut child,
        Duration::from_secs(script.timeout_seconds.max(1) as u64),
    );
    let status = child.wait().ok();

    let stdout = stdout_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stderr = stderr_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let (stdout, _) = capped(&stdout);
    let (stderr, _) = capped(&stderr);

    ScriptResult {
        run_id,
        script_id: script.id.clone(),
        trigger: trigger.to_owned(),
        exit_code: status.as_ref().map(exit_code),
        stdout: redact(&stdout, &secrets),
        stderr: redact(&stderr, &secrets),
        duration_ms: started_instant.elapsed().as_millis() as i64,
        started_at: iso(started),
        finished_at: iso(Utc::now()),
        detail: timed_out.then(|| TIMEOUT_DETAIL.to_owned()),
        timed_out,
    }
}

/// Poll until the child exits. At the deadline send SIGTERM (matching the
/// Swift agent), then kill after a grace period so a body that traps SIGTERM
/// cannot hang the daemon forever.
fn wait_with_timeout(child: &mut Child, timeout: Duration) -> bool {
    let started = Instant::now();
    let mut terminated_at: Option<Instant> = None;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return terminated_at.is_some(),
            Err(_) => return terminated_at.is_some(),
            Ok(None) => {}
        }

        if terminated_at.is_none() && started.elapsed() >= timeout {
            let _ = terminate(child);
            terminated_at = Some(Instant::now());
        } else if terminated_at.is_some_and(|at| at.elapsed() >= TERMINATE_GRACE) {
            let _ = child.kill();
            return true;
        }

        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(unix)]
fn terminate(child: &mut Child) -> std::io::Result<()> {
    // SAFETY: the pid is live until wait reaps it; kill with SIGTERM is safe.
    let result = unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };

    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn terminate(child: &mut Child) -> std::io::Result<()> {
    child.kill()
}

/// Swift reported a signal death as the signal number; `ExitStatus::code`
/// returns `None` for that case, so fall back to the signal.
fn exit_code(status: &ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.signal().unwrap_or(0)
    }

    #[cfg(not(unix))]
    {
        -1
    }
}

fn shell_list() -> &'static str {
    #[cfg(unix)]
    {
        "bash, zsh or sh"
    }

    #[cfg(not(unix))]
    {
        "pwsh"
    }
}

fn iso(time: chrono::DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::EnvironmentEntry;
    use crate::trigger::Trigger;

    fn script() -> InstalledScript {
        InstalledScript {
            id: "script-1".into(),
            name: "Test".into(),
            language: "sh".into(),
            body: "echo hi".into(),
            run_as: "user".into(),
            timeout_seconds: 300,
            environment: vec![
                EnvironmentEntry {
                    name: "TOKEN".into(),
                    value: "super-secret".into(),
                    secret: true,
                },
                EnvironmentEntry {
                    name: "REGION".into(),
                    value: "eu".into(),
                    secret: false,
                },
            ],
            trigger: Trigger::from_payload("install", None, None),
            run_id: None,
            server_url: "https://example.test".into(),
            device_token: "device".into(),
        }
    }

    #[test]
    fn caps_at_64_kib_and_marks_truncation() {
        let exact = vec![b'a'; crate::OUTPUT_LIMIT];
        let (text, truncated) = capped(&exact);
        assert_eq!(text.len(), crate::OUTPUT_LIMIT);
        assert!(!truncated);

        let over = vec![b'b'; crate::OUTPUT_LIMIT + 10];
        let (text, truncated) = capped(&over);
        assert!(truncated);
        assert_eq!(
            text.len(),
            crate::OUTPUT_LIMIT + crate::OUTPUT_TRUNCATED_MARKER.len()
        );
        assert!(text.ends_with(crate::OUTPUT_TRUNCATED_MARKER));
        assert!(text.starts_with(&"b".repeat(16)));
    }

    #[test]
    fn redacts_every_secret_and_ignores_empty_values() {
        let text = "token=super-secret region=eu again super-secret";
        let redacted = redact(text, &["super-secret".into(), "".into(), "eu".into()]);

        assert_eq!(
            redacted,
            "token=[redacted] region=[redacted] again [redacted]"
        );
    }

    #[test]
    fn child_environment_overrides_and_marks_the_run() {
        let script = script();
        let environment = child_environment(
            &script,
            "cron",
            vec![
                (OsString::from("PATH"), OsString::from("/usr/bin")),
                (OsString::from("TOKEN"), OsString::from("daemon-token")),
            ],
        );
        let lookup = |name: &str| {
            environment
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.to_string_lossy().into_owned())
        };

        assert_eq!(lookup("TOKEN").as_deref(), Some("super-secret"));
        assert_eq!(lookup("REGION").as_deref(), Some("eu"));
        assert_eq!(lookup("MATTRAX_TRIGGER_TYPE").as_deref(), Some("cron"));
        assert_eq!(lookup("MATTRAX_SCRIPT_ID").as_deref(), Some("script-1"));
        assert_eq!(lookup("PATH").as_deref(), Some("/usr/bin"));
    }

    #[cfg(unix)]
    #[test]
    fn user_scripts_go_through_launchctl_asuser() {
        let (program, arguments) =
            shell_invocation("bash", "echo hi", "user", Some(501)).expect("invocation");

        assert_eq!(program, "/bin/launchctl");
        assert_eq!(
            arguments,
            vec!["asuser", "501", "/bin/bash", "-c", "echo hi"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn root_scripts_run_directly_and_unsupported_languages_are_skipped() {
        let (program, arguments) =
            shell_invocation("zsh", "echo hi", "root", None).expect("invocation");
        assert_eq!(program, "/bin/zsh");
        assert_eq!(arguments, vec!["-c", "echo hi"]);

        assert!(shell_invocation("pwsh", "Get-Date", "root", None).is_err());
        assert!(shell_invocation("bash", "true", "user", None).is_err());
    }

    #[test]
    fn output_is_lossy_utf8_like_the_swift_agent() {
        let (text, _) = capped(&[0xff, 0xfe, b'o', b'k']);
        assert!(text.ends_with("ok"));
    }
}
