//! The daemon loop and one-shot tick.

use crate::exec;
use crate::host::{self, HostContext};
use crate::logging::Logger;
use crate::profiles::{self, InstalledScript};
use crate::restricted::{self, LiveRestrictedRunner};
use crate::result::{self, RestrictedResultQueue, ScriptResult};
use crate::state::{self, AgentState, ScriptState};
use crate::trigger::{self, TriggerKind};
use chrono::{DateTime, Local};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const TICK_INTERVAL: Duration = Duration::from_secs(30);

/// Executes and posts one run. The daemon uses [`LiveRunner`]; tests use a
/// recorder so the tick can be exercised without root, macOS or a server.
pub trait ScriptRunner {
    fn execute(&self, script: &InstalledScript, trigger: &str) -> ScriptResult;
    fn post(&self, script: &InstalledScript, result: &ScriptResult, logger: &Logger);
}

pub struct LiveRunner;

impl ScriptRunner for LiveRunner {
    fn execute(&self, script: &InstalledScript, trigger: &str) -> ScriptResult {
        exec::execute(script, trigger)
    }

    fn post(&self, script: &InstalledScript, result: &ScriptResult, logger: &Logger) {
        result::post(script, result, logger);
    }
}

pub struct Agent {
    state_path: PathBuf,
    pub logger: Logger,
    runner: Box<dyn ScriptRunner>,
    restricted_results: RestrictedResultQueue,
}

impl Agent {
    pub fn system() -> Self {
        let state_path = PathBuf::from(crate::STATE_PATH);
        let restricted_results = RestrictedResultQueue::system(&state_path);

        Self {
            state_path,
            logger: Logger::system(),
            runner: Box::new(LiveRunner),
            restricted_results,
        }
    }

    pub fn with_runner(
        state_path: impl Into<PathBuf>,
        logger: Logger,
        runner: Box<dyn ScriptRunner>,
    ) -> Self {
        let state_path: PathBuf = state_path.into();
        let restricted_results = RestrictedResultQueue::system(&state_path);

        Self {
            state_path,
            logger,
            runner,
            restricted_results,
        }
    }

    pub fn state_path(&self) -> &Path {
        &self.state_path
    }

    /// Evaluate every installed script once and persist state.
    pub fn run_once(&self) {
        let mut state = state::load(&self.state_path);
        let profile_snapshot = profiles::installed_profile_values();
        let scripts = profiles::installed_scripts_from_profiles(&profile_snapshot);
        let restricted_rules =
            restricted::installed_restricted_software_from_profiles(&profile_snapshot);
        let host = host::collect();
        let now = Local::now();

        tick(
            &scripts,
            &mut state,
            now,
            &host,
            self.runner.as_ref(),
            &self.logger,
        );

        restricted::tick(
            &restricted_rules,
            &mut state.restricted,
            now,
            &LiveRestrictedRunner::new(self.restricted_results.clone()),
            &self.logger,
        );

        if let Err(error) = state::save(&self.state_path, &state) {
            self.logger.log(format!("could not save state: {error}"));
        }
    }

    /// The launchd keepalive loop. It never returns; a failed tick is logged and
    /// retried on the next interval.
    pub fn run_forever(&self) -> ! {
        self.logger
            .log(format!("mattraxd {} starting", crate::VERSION));

        let _restricted_result_worker = self.restricted_results.start_worker();

        loop {
            self.run_once();
            std::thread::sleep(TICK_INTERVAL);
        }
    }
}

/// One scheduling pass. Pure except for the injected runner, so tests can
/// assert every trigger decision.
pub fn tick(
    scripts: &[InstalledScript],
    state: &mut AgentState,
    now: DateTime<Local>,
    host: &HostContext,
    runner: &dyn ScriptRunner,
    logger: &Logger,
) {
    let startup_due = state.last_boot != host.boot_time;
    let previous_console = state.last_console_user.clone();
    let now_seconds = now.timestamp_millis() as f64 / 1000.0;
    let now_minute = now.timestamp() / 60;

    for script in scripts {
        let mut script_state: ScriptState =
            state.scripts.get(&script.id).cloned().unwrap_or_default();
        let digest = trigger::script_digest(script);
        let mut due = trigger::decide(script, &script_state, now, startup_due);

        if let Some(trigger_name) = trigger::session_change_trigger(
            script.trigger.kind,
            &previous_console,
            &host.console_user,
        ) {
            due.push(trigger_name);
        }

        if let Some(trigger_name) = trigger::network_change_trigger(
            script.trigger.kind,
            &state.last_network_hash,
            &host.network_hash,
        ) {
            due.push(trigger_name);
        }

        // Stable de-duplication: the Swift agent used a Set here, so a script
        // whose manual run and schedule both fired ran once per trigger, not once
        // per duplicate entry.
        let mut unique = Vec::with_capacity(due.len());

        for trigger_name in due {
            if !unique.contains(&trigger_name) {
                unique.push(trigger_name);
            }
        }

        for trigger_name in unique {
            let result = runner.execute(script, trigger_name);
            runner.post(script, &result, logger);

            trigger::record_run(
                &mut script_state,
                script.run_id.as_deref(),
                trigger_name,
                now_seconds,
                now_minute,
            );

            logger.log(format!(
                "{} ran ({}) exit={}",
                script.id,
                trigger_name,
                result
                    .exit_code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "none".into())
            ));
        }

        script_state.digest = digest;
        state.scripts.insert(script.id.clone(), script_state);
    }

    state.last_boot = host.boot_time.clone();
    state.last_console_user = host.console_user.clone();
    state.last_network_hash = host.network_hash.clone();
}

/// The trigger name list used by the login/logout path is intentionally the
/// same string the server stores.
pub fn trigger_name(kind: TriggerKind) -> &'static str {
    match kind {
        TriggerKind::Install => "install",
        TriggerKind::Startup => "startup",
        TriggerKind::Login => "login",
        TriggerKind::Logout => "logout",
        TriggerKind::NetworkChange => "network-change",
        TriggerKind::Interval => "interval",
        TriggerKind::Cron => "cron",
        TriggerKind::Manual => "manual",
        TriggerKind::Other => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::{EnvironmentEntry, InstalledScript};
    use crate::trigger::Trigger;
    use chrono::TimeZone;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Recorder {
        runs: Mutex<Vec<(String, String)>>,
        posted: Mutex<Vec<String>>,
    }

    impl ScriptRunner for Recorder {
        fn execute(&self, script: &InstalledScript, trigger: &str) -> ScriptResult {
            self.runs
                .lock()
                .unwrap()
                .push((script.id.clone(), trigger.to_owned()));

            ScriptResult {
                run_id: script
                    .run_id
                    .clone()
                    .unwrap_or_else(|| "trigger-test".into()),
                script_id: script.id.clone(),
                trigger: trigger.to_owned(),
                exit_code: Some(0),
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: 1,
                started_at: "2026-11-20T00:00:00Z".into(),
                finished_at: "2026-11-20T00:00:00Z".into(),
                detail: None,
                timed_out: false,
            }
        }

        fn post(&self, _script: &InstalledScript, result: &ScriptResult, _logger: &Logger) {
            self.posted.lock().unwrap().push(result.trigger.clone());
        }
    }

    fn host(console: &str, network: &str) -> HostContext {
        HostContext {
            boot_time: "boot-1".into(),
            console_user: console.into(),
            network_hash: network.into(),
        }
    }

    fn now() -> DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 11, 20, 14, 30, 0)
            .single()
            .unwrap()
    }

    fn script(trigger_type: &str) -> InstalledScript {
        InstalledScript {
            id: "script-1".into(),
            name: "Test".into(),
            language: "sh".into(),
            body: "echo hi".into(),
            run_as: "root".into(),
            timeout_seconds: 300,
            environment: Vec::<EnvironmentEntry>::new(),
            trigger: Trigger::from_payload(trigger_type, None, None),
            run_id: None,
            server_url: "https://example.test".into(),
            device_token: "token".into(),
        }
    }

    fn runs(recorder: &Recorder) -> Vec<String> {
        recorder
            .runs
            .lock()
            .unwrap()
            .iter()
            .map(|(_, trigger)| trigger.clone())
            .collect()
    }

    #[test]
    fn one_profile_snapshot_feeds_scripts_and_restricted_rules() {
        let snapshot = vec![plist::from_bytes(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>PayloadContent</key><array>
  <dict>
    <key>PayloadType</key><string>com.mattrax.script</string>
    <key>ScriptID</key><string>script-1</string>
    <key>Content</key><string>true</string>
    <key>ServerURL</key><string>https://mattrax.test</string>
    <key>DeviceToken</key><string>token</string>
  </dict>
  <dict>
    <key>PayloadType</key><string>com.mattrax.restricted-software</string>
    <key>RestrictedSoftwareID</key><string>rule-1</string>
    <key>MatchType</key><string>process-name</string>
    <key>MatchValue</key><string>Banned</string>
    <key>Action</key><string>kill-process</string>
    <key>ServerURL</key><string>https://mattrax.test</string>
    <key>DeviceToken</key><string>token</string>
  </dict>
</array></dict></plist>"#,
        )
        .expect("profile parses")];

        let scripts = profiles::installed_scripts_from_profiles(&snapshot);
        let rules = restricted::installed_restricted_software_from_profiles(&snapshot);

        assert_eq!(scripts.len(), 1);
        assert_eq!(rules.len(), 1);
        assert_eq!(scripts[0].id, "script-1");
        assert_eq!(rules[0].id, "rule-1");
    }

    #[test]
    fn install_runs_once_and_records_the_digest() {
        let recorder = Recorder::default();
        let logger = Logger::stderr_only();
        let mut state = AgentState::default();
        let scripts = vec![script("install")];

        tick(
            &scripts,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["install"]);
        assert_eq!(
            state.scripts["script-1"].digest,
            trigger::script_digest(&scripts[0])
        );

        tick(
            &scripts,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["install"]);
    }

    #[test]
    fn manual_run_ids_are_consumed_once() {
        let recorder = Recorder::default();
        let logger = Logger::stderr_only();
        let mut state = AgentState::default();
        let mut script = script("manual");
        script.run_id = Some("run-1".into());

        tick(
            &[script.clone()],
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        tick(
            &[script],
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );

        assert_eq!(runs(&recorder), vec!["manual"]);
        assert_eq!(state.scripts["script-1"].executed_runs, vec!["run-1"]);
        assert_eq!(recorder.posted.lock().unwrap().len(), 1);
    }

    #[test]
    fn startup_fires_when_the_boot_marker_changes() {
        let recorder = Recorder::default();
        let logger = Logger::stderr_only();
        let mut state = AgentState::default();
        let scripts = vec![script("startup")];

        tick(
            &scripts,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        tick(
            &scripts,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["startup"]);

        let mut rebooted = host("", "net");
        rebooted.boot_time = "boot-2".into();
        tick(&scripts, &mut state, now(), &rebooted, &recorder, &logger);
        assert_eq!(runs(&recorder), vec!["startup", "startup"]);
    }

    #[test]
    fn login_and_logout_follow_console_changes() {
        let recorder = Recorder::default();
        let logger = Logger::stderr_only();
        let mut state = AgentState::default();
        let login = vec![script("login")];
        let logout = vec![script("logout")];

        tick(
            &login,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        tick(
            &login,
            &mut state,
            now(),
            &host("alice", "net"),
            &recorder,
            &logger,
        );
        tick(
            &login,
            &mut state,
            now(),
            &host("alice", "net"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["login"]);

        tick(
            &logout,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["login", "logout"]);
    }

    #[test]
    fn network_change_needs_a_previous_fingerprint() {
        let recorder = Recorder::default();
        let logger = Logger::stderr_only();
        let mut state = AgentState::default();
        let scripts = vec![script("networkstatechange")];

        tick(
            &scripts,
            &mut state,
            now(),
            &host("", "net-a"),
            &recorder,
            &logger,
        );
        assert!(runs(&recorder).is_empty());

        tick(
            &scripts,
            &mut state,
            now(),
            &host("", "net-b"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["network-change"]);

        tick(
            &scripts,
            &mut state,
            now(),
            &host("", "net-b"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["network-change"]);
    }

    #[test]
    fn interval_and_cron_fire_on_their_schedule() {
        let recorder = Recorder::default();
        let logger = Logger::stderr_only();
        let mut state = AgentState::default();
        let interval = vec![script("interval")];

        tick(
            &interval,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        tick(
            &interval,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["interval"]);

        let cron = vec![{
            let mut script = script("timer");
            script.trigger = Trigger::from_payload("timer", None, Some("*/30 * * * *".into()));
            script
        }];

        tick(
            &cron,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        tick(
            &cron,
            &mut state,
            now(),
            &host("", "net"),
            &recorder,
            &logger,
        );
        assert_eq!(runs(&recorder), vec!["interval", "cron"]);
    }

    #[test]
    fn every_trigger_name_is_the_wire_value() {
        assert_eq!(trigger_name(TriggerKind::NetworkChange), "network-change");
        assert_eq!(trigger_name(TriggerKind::Install), "install");
    }
}
