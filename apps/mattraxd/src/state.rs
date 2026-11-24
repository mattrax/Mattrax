//! Persistent agent state.
//!
//! The agent-state JSON shape is the one the Swift agent wrote, so an upgrade
//! keeps manual run ids and trigger timestamps. Agent state never contains
//! script bodies, output or tokens.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptState {
    /// Digest of the last installed revision, used by the install trigger.
    pub digest: String,
    /// Trigger name to the Unix timestamp (seconds, fractional) of the last run.
    pub last_run: BTreeMap<String, f64>,
    /// Cron minute (Unix minutes) that last ran, to fire once per minute.
    pub last_minute: BTreeMap<String, i64>,
    /// Manual run ids already executed, newest last.
    pub executed_runs: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RestrictedState {
    /// Digest of the last applied rule revision.
    pub digest: String,
    /// Unix seconds of the last enforcement pass.
    pub last_run: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentState {
    pub scripts: BTreeMap<String, ScriptState>,
    /// Restricted software rules by rule id.
    pub restricted: BTreeMap<String, RestrictedState>,
    /// `kern.boottime`, so a reboot fires startup triggers once.
    pub last_boot: String,
    /// Last console user, so login/logout can be detected.
    pub last_console_user: String,
    /// Fingerprint of the last network configuration.
    pub last_network_hash: String,
}

pub fn load(path: &Path) -> AgentState {
    load_json(path)
}

pub(crate) fn load_json<T>(path: &Path) -> T
where
    T: DeserializeOwned + Default,
{
    fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

/// Write through a sibling temp file and rename, so a crash mid-write cannot
/// leave a truncated state file. Failures are reported to the caller; the
/// daemon logs them and keeps running with in-memory state.
pub fn save(path: &Path, state: &AgentState) -> io::Result<()> {
    save_json(path, state)
}

pub(crate) fn save_json<T>(path: &Path, value: &T) -> io::Result<()>
where
    T: Serialize,
{
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)?;
    }

    let data = serde_json::to_vec(value)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let temporary = path.with_extension(format!("json.tmp.{}", std::process::id()));

    fs::write(&temporary, &data)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
    }

    // Windows cannot rename over an existing file. Losing the atomic swap
    // there is acceptable: the data is flushed to the temp file first.
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)?;
    }

    fs::rename(&temporary, path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn reads_the_swift_state_shape() {
        let json = r#"{
      "scripts": {
        "script-1": {
          "digest": "abc",
          "lastRun": { "interval": 1700000000.5 },
          "lastMinute": { "cron": 28333333 },
          "executedRuns": ["run-1"]
        }
      },
      "lastBoot": "boot",
      "lastConsoleUser": "alice",
      "lastNetworkHash": "ff"
    }"#;

        let state: AgentState = serde_json::from_str(json).expect("state parses");

        assert_eq!(state.last_boot, "boot");
        assert_eq!(state.last_console_user, "alice");
        assert_eq!(state.last_network_hash, "ff");

        let script = state.scripts.get("script-1").expect("script state");
        assert_eq!(script.digest, "abc");
        assert_eq!(script.last_run.get("interval"), Some(&1700000000.5));
        assert_eq!(script.last_minute.get("cron"), Some(&28333333));
        assert_eq!(script.executed_runs, vec!["run-1"]);
    }

    #[test]
    fn missing_fields_default() {
        let state: AgentState = serde_json::from_str("{}").expect("empty state parses");

        assert_eq!(state, AgentState::default());
    }

    #[test]
    fn serialises_camel_case_keys() {
        let mut state = AgentState {
            last_boot: "boot".into(),
            ..AgentState::default()
        };
        state.scripts.insert(
            "script-1".into(),
            ScriptState {
                digest: "abc".into(),
                executed_runs: vec!["run-1".into()],
                ..ScriptState::default()
            },
        );

        let json = serde_json::to_string(&state).expect("state serialises");

        assert!(json.contains("\"lastBoot\":\"boot\""));
        assert!(json.contains("\"executedRuns\":[\"run-1\"]"));
    }

    #[test]
    fn saves_and_loads_atomically() {
        let directory = tempdir().expect("temp dir");
        let path = directory.path().join("nested/mattraxd-state.json");
        let state = AgentState {
            last_network_hash: "abc".into(),
            ..AgentState::default()
        };

        save(&path, &state).expect("state saves");

        assert_eq!(load(&path), state);

        // Missing or corrupt state is empty state, never a failed daemon.
        fs::write(&path, b"{not json").expect("write corrupt state");
        assert_eq!(load(&path), AgentState::default());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }
}
