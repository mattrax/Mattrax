//! Trigger payloads and scheduled-run decisions.
//!
//! The server has always delivered two vocabularies: the logical trigger
//! (`install`, `interval`, `cron`, `network-change`, ...) and the older
//! profile names (`timer`, `networkstatechange`). Both are accepted; the raw
//! name is still part of the script digest, exactly as the Swift agent hashed
//! it, so an upgrade does not re-fire an install trigger.

use crate::cron;
use crate::profiles::InstalledScript;
use crate::state::ScriptState;
use chrono::{DateTime, Local};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerKind {
    Install,
    Startup,
    Login,
    Logout,
    NetworkChange,
    Interval,
    Cron,
    Manual,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trigger {
    pub kind: TriggerKind,
    /// Exactly what the profile carried. Part of the digest for compatibility.
    pub raw_type: String,
    pub interval_seconds: Option<i64>,
    pub cron_expression: Option<String>,
}

impl Trigger {
    pub fn from_payload(
        raw_type: &str,
        interval_seconds: Option<i64>,
        cron_expression: Option<String>,
    ) -> Self {
        let kind = match raw_type {
            "install" => TriggerKind::Install,
            "startup" => TriggerKind::Startup,
            "login" => TriggerKind::Login,
            "logout" => TriggerKind::Logout,
            "network-change" | "networkstatechange" => TriggerKind::NetworkChange,
            "interval" => TriggerKind::Interval,
            "cron" => TriggerKind::Cron,
            "manual" => TriggerKind::Manual,
            // Older profiles wrapped both timer forms in one `timer` payload.
            "timer"
                if cron_expression
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()) =>
            {
                TriggerKind::Cron
            }
            "timer" => TriggerKind::Interval,
            _ => TriggerKind::Other,
        };

        Self {
            kind,
            raw_type: raw_type.to_owned(),
            interval_seconds,
            cron_expression,
        }
    }
}

/// FNV-1a over the fields that define a revision of a script. A changed body,
/// shell, timeout, trigger, environment or run-as user changes the digest and
/// re-fires the install trigger; a new `RunID` only does not.
pub fn script_digest(script: &InstalledScript) -> String {
    let mut environment: Vec<String> = script
        .environment
        .iter()
        .map(|entry| format!("{}={}={}", entry.name, entry.value, entry.secret))
        .collect();

    // Swift iterated a dictionary, whose order is unspecified. Sorting makes the
    // digest stable across runs and across the rewrite.
    environment.sort();

    let source = [
        script.id.clone(),
        script.language.clone(),
        script.body.clone(),
        script.run_as.clone(),
        script.timeout_seconds.to_string(),
        script.trigger.raw_type.clone(),
        script.trigger.interval_seconds.unwrap_or(0).to_string(),
        script.trigger.cron_expression.clone().unwrap_or_default(),
        script.server_url.clone(),
        script.device_token.clone(),
        environment.join("\u{1e}"),
    ]
    .join("\u{1f}");

    crate::util::fnv1a64_hex(source.as_bytes())
}

/// Triggers due for a script in one tick. Session and network triggers are
/// evaluated separately because they depend on host context, not the script.
pub fn decide(
    script: &InstalledScript,
    state: &ScriptState,
    now: DateTime<Local>,
    startup_due: bool,
) -> Vec<&'static str> {
    let mut due = Vec::new();

    // A manual run carries a RunID and is due regardless of the script's own
    // trigger; the id is remembered so a re-delivered profile runs once.
    if let Some(run_id) = script.run_id.as_deref() {
        if !state
            .executed_runs
            .iter()
            .any(|executed| executed == run_id)
        {
            due.push("manual");
        }
    }

    match script.trigger.kind {
        TriggerKind::Install => {
            if state.digest != script_digest(script) {
                due.push("install");
            }
        }
        TriggerKind::Startup => {
            if startup_due {
                due.push("startup");
            }
        }
        TriggerKind::Interval => {
            let interval = script.trigger.interval_seconds.unwrap_or(3600).max(60) as f64;
            let last = state.last_run.get("interval").copied().unwrap_or(0.0);

            if now.timestamp_millis() as f64 / 1000.0 - last >= interval {
                due.push("interval");
            }
        }
        TriggerKind::Cron => {
            let minute = now.timestamp() / 60;

            if state.last_minute.get("cron").copied() != Some(minute)
                && cron::matches_local(script.trigger.cron_expression.as_deref().unwrap_or(""), now)
            {
                due.push("cron");
            }
        }
        TriggerKind::Login | TriggerKind::Logout | TriggerKind::NetworkChange => {}
        TriggerKind::Manual | TriggerKind::Other => {}
    }

    due
}

/// Login/logout fired by a console-session change. Swift suppressed the event
/// when both the previous and current user were empty (a daemon restart with
/// nobody logged in).
pub fn session_change_trigger(
    kind: TriggerKind,
    previous_console_user: &str,
    console_user: &str,
) -> Option<&'static str> {
    if previous_console_user.is_empty() && console_user.is_empty() {
        return None;
    }

    if previous_console_user == console_user {
        return None;
    }

    match kind {
        TriggerKind::Login if !console_user.is_empty() => Some("login"),
        TriggerKind::Logout if !previous_console_user.is_empty() => Some("logout"),
        _ => None,
    }
}

/// Network-change fires only when there is a previous fingerprint to compare
/// against, so the first tick after install does not count as a change.
pub fn network_change_trigger(
    kind: TriggerKind,
    previous_hash: &str,
    current_hash: &str,
) -> Option<&'static str> {
    if kind == TriggerKind::NetworkChange
        && !previous_hash.is_empty()
        && previous_hash != current_hash
    {
        Some("network-change")
    } else {
        None
    }
}

/// Apply one run to a script's state. Pure so the daemon loop can be tested
/// without executing anything.
pub fn record_run(
    state: &mut ScriptState,
    run_id: Option<&str>,
    trigger: &str,
    now_seconds: f64,
    now_minute: i64,
) {
    state.last_run.insert(trigger.to_owned(), now_seconds);

    if trigger == "cron" {
        state.last_minute.insert("cron".to_owned(), now_minute);
    }

    if let Some(run_id) = run_id {
        state.executed_runs.push(run_id.to_owned());

        // Keep the newest 200 ids; a device that has been running for years must
        // not grow the state file without bound.
        if state.executed_runs.len() > 200 {
            let excess = state.executed_runs.len() - 200;
            state.executed_runs.drain(0..excess);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::{EnvironmentEntry, InstalledScript};
    use chrono::TimeZone;

    fn script(trigger: Trigger) -> InstalledScript {
        InstalledScript {
            id: "script-1".into(),
            name: "Test".into(),
            language: "sh".into(),
            body: "echo hi".into(),
            run_as: "root".into(),
            timeout_seconds: 300,
            environment: Vec::new(),
            trigger,
            run_id: None,
            server_url: "https://example.test".into(),
            device_token: "token".into(),
        }
    }

    fn now() -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 11, 20, 14, 30, 0)
            .single()
            .expect("valid local time")
    }

    #[test]
    fn legacy_payload_names_map_to_logical_triggers() {
        assert_eq!(
            Trigger::from_payload("timer", Some(120), None).kind,
            TriggerKind::Interval
        );
        assert_eq!(
            Trigger::from_payload("timer", None, Some("0 3 * * *".into())).kind,
            TriggerKind::Cron
        );
        assert_eq!(
            Trigger::from_payload("networkstatechange", None, None).kind,
            TriggerKind::NetworkChange
        );
        assert_eq!(
            Trigger::from_payload("startup", None, None).kind,
            TriggerKind::Startup
        );
        assert_eq!(
            Trigger::from_payload("something-new", None, None).kind,
            TriggerKind::Other
        );
    }

    #[test]
    fn install_fires_until_the_digest_is_recorded() {
        let script = script(Trigger::from_payload("install", None, None));
        let mut state = ScriptState::default();

        assert_eq!(decide(&script, &state, now(), false), vec!["install"]);

        state.digest = script_digest(&script);
        assert!(decide(&script, &state, now(), false).is_empty());

        // A new body is a new revision.
        let mut changed = script;
        changed.body = "echo changed".into();
        assert_eq!(decide(&changed, &state, now(), false), vec!["install"]);
    }

    #[test]
    fn manual_fires_once_per_run_id() {
        let mut script = script(Trigger::from_payload("manual", None, None));
        script.run_id = Some("run-1".into());
        let mut state = ScriptState::default();

        assert_eq!(decide(&script, &state, now(), false), vec!["manual"]);

        state.executed_runs.push("run-1".into());
        assert!(decide(&script, &state, now(), false).is_empty());
    }

    #[test]
    fn interval_respects_the_minimum_and_configured_value() {
        let script = script(Trigger::from_payload("timer", Some(60), None));
        let mut state = ScriptState::default();
        let current = now();
        let seconds = current.timestamp() as f64;

        state.last_run.insert("interval".into(), seconds - 59.0);
        assert!(decide(&script, &state, current, false).is_empty());

        state.last_run.insert("interval".into(), seconds - 60.0);
        assert_eq!(decide(&script, &state, current, false), vec!["interval"]);

        // A profile asking for one second is clamped to the documented minimum.
        let too_fast = script_with_interval(1);
        state.last_run.insert("interval".into(), seconds - 59.0);
        assert!(decide(&too_fast, &state, current, false).is_empty());

        // No recorded run means due immediately.
        let fresh = ScriptState::default();
        assert_eq!(decide(&too_fast, &fresh, current, false), vec!["interval"]);
    }

    fn script_with_interval(interval: i64) -> InstalledScript {
        script(Trigger::from_payload("timer", Some(interval), None))
    }

    #[test]
    fn cron_fires_once_per_minute() {
        let script = script(Trigger::from_payload(
            "timer",
            None,
            Some("30 14 * * *".into()),
        ));
        let mut state = ScriptState::default();
        let current = now();

        assert_eq!(decide(&script, &state, current, false), vec!["cron"]);

        state
            .last_minute
            .insert("cron".into(), current.timestamp() / 60);
        assert!(decide(&script, &state, current, false).is_empty());
    }

    #[test]
    fn startup_uses_the_boot_marker() {
        let script = script(Trigger::from_payload("startup", None, None));
        let state = ScriptState::default();

        assert_eq!(decide(&script, &state, now(), true), vec!["startup"]);
        assert!(decide(&script, &state, now(), false).is_empty());
    }

    #[test]
    fn session_changes_only_fire_for_the_matching_trigger() {
        assert_eq!(
            session_change_trigger(TriggerKind::Login, "", "alice"),
            Some("login")
        );
        assert_eq!(
            session_change_trigger(TriggerKind::Login, "alice", ""),
            None
        );
        assert_eq!(
            session_change_trigger(TriggerKind::Logout, "alice", ""),
            Some("logout")
        );
        // A user-to-user switch still ends the previous session, so logout fires.
        assert_eq!(
            session_change_trigger(TriggerKind::Logout, "alice", "bob"),
            Some("logout")
        );
        assert_eq!(session_change_trigger(TriggerKind::Login, "", ""), None);
        assert_eq!(
            session_change_trigger(TriggerKind::Login, "alice", "alice"),
            None
        );
    }

    #[test]
    fn network_changes_need_a_previous_fingerprint() {
        assert_eq!(
            network_change_trigger(TriggerKind::NetworkChange, "", "abc"),
            None
        );
        assert_eq!(
            network_change_trigger(TriggerKind::NetworkChange, "abc", "abc"),
            None
        );
        assert_eq!(
            network_change_trigger(TriggerKind::NetworkChange, "abc", "def"),
            Some("network-change")
        );
    }

    #[test]
    fn recording_a_run_updates_timestamps_and_caps_run_ids() {
        let mut state = ScriptState::default();

        record_run(&mut state, Some("run-1"), "manual", 1000.0, 16);
        assert_eq!(state.last_run.get("manual"), Some(&1000.0));
        assert_eq!(state.executed_runs, vec!["run-1"]);

        record_run(&mut state, Some("run-2"), "cron", 2000.0, 33);
        assert_eq!(state.last_run.get("cron"), Some(&2000.0));
        assert_eq!(state.last_minute.get("cron"), Some(&33));

        for index in 0..300 {
            record_run(&mut state, Some(&format!("run-{index}")), "manual", 0.0, 0);
        }

        assert_eq!(state.executed_runs.len(), 200);
        assert_eq!(
            state.executed_runs.last().map(String::as_str),
            Some("run-299")
        );
    }

    #[test]
    fn digest_is_stable_and_covers_environment() {
        let mut script = script(Trigger::from_payload("install", None, None));
        script.environment = vec![
            EnvironmentEntry {
                name: "B".into(),
                value: "two".into(),
                secret: false,
            },
            EnvironmentEntry {
                name: "A".into(),
                value: "one".into(),
                secret: true,
            },
        ];

        let digest = script_digest(&script);

        script.environment.reverse();
        assert_eq!(script_digest(&script), digest);

        script.environment[0].value = "changed".into();
        assert_ne!(script_digest(&script), digest);
    }
}
