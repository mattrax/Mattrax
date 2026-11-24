//! Reading `com.mattrax.script` payloads from installed configuration profiles.
//!
//! Only macOS has a profile store. On other platforms `installed_scripts`
//! returns nothing; the Windows script channel (`GET
//! /api/v1/script-agent/scripts`) is a separate delivery path that is not part
//! of this rewrite.

use crate::trigger::Trigger;
use plist::Value;
use std::collections::BTreeMap;
#[cfg(target_os = "macos")]
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentEntry {
    pub name: String,
    pub value: String,
    pub secret: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledScript {
    pub id: String,
    pub name: String,
    pub language: String,
    pub body: String,
    pub run_as: String,
    pub timeout_seconds: i64,
    pub environment: Vec<EnvironmentEntry>,
    pub trigger: Trigger,
    pub run_id: Option<String>,
    pub server_url: String,
    pub device_token: String,
}

/// Every installed configuration profile. Shared by the script and restricted
/// software readers so both see the same profile snapshot in one tick.
pub(crate) fn installed_profile_values() -> Vec<Value> {
    #[cfg(target_os = "macos")]
    {
        let mut profiles = Vec::new();

        for identifier in installed_profile_identifiers() {
            if let Some(profile) = profile_contents(&identifier) {
                profiles.push(profile);
            }
        }

        profiles
    }

    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

/// Installed scripts from every installed profile. Repeated profiles yield
/// repeated scripts, which the result endpoint deduplicates on run id.
pub fn installed_scripts() -> Vec<InstalledScript> {
    installed_profile_values()
        .iter()
        .flat_map(scripts_from_profile)
        .collect()
}

/// Parse one installed profile (the `profiles -P -p <id>` output).
pub fn scripts_from_profile(profile: &Value) -> Vec<InstalledScript> {
    let Some(payloads) = profile
        .as_dictionary()
        .and_then(|profile| profile.get("PayloadContent"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    payloads
        .iter()
        .filter(|payload| string(payload, "PayloadType") == Some(crate::SCRIPT_PAYLOAD_TYPE))
        .filter_map(parse_payload)
        .collect()
}

fn parse_payload(payload: &Value) -> Option<InstalledScript> {
    let id = string(payload, "ScriptID")?.to_owned();
    let body = string(payload, "Content")?.to_owned();
    let server_url = string(payload, "ServerURL")?.to_owned();
    let device_token = string(payload, "DeviceToken")?.to_owned();

    let triggers = payload
        .as_dictionary()
        .and_then(|payload| payload.get("Triggers"))
        .and_then(Value::as_array);
    let first_trigger = triggers.and_then(|triggers| triggers.first());
    let trigger_type = first_trigger
        .and_then(|trigger| string(trigger, "Type"))
        .unwrap_or("install")
        .to_owned();
    let interval_seconds = first_trigger.and_then(|trigger| integer(trigger, "TimerInterval"));
    let cron_expression = first_trigger
        .and_then(|trigger| string(trigger, "CronExpression"))
        .map(str::to_owned);

    let flagged: Vec<&str> = payload
        .as_dictionary()
        .and_then(|payload| payload.get("SecretEnvironment"))
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(Value::as_string).collect())
        .unwrap_or_default();

    let mut environment = BTreeMap::new();

    if let Some(entries) = payload
        .as_dictionary()
        .and_then(|payload| payload.get("Environment"))
        .and_then(Value::as_dictionary)
    {
        for (name, value) in entries {
            let Some(value) = value.as_string() else {
                continue;
            };

            environment.insert(
                name.clone(),
                EnvironmentEntry {
                    name: name.clone(),
                    value: value.to_owned(),
                    secret: flagged.contains(&name.as_str()) || looks_secret(name),
                },
            );
        }
    }

    let run_id = string(payload, "RunID")
        .filter(|value| !value.is_empty())
        .map(str::to_owned);

    Some(InstalledScript {
        name: string(payload, "PayloadDisplayName")
            .unwrap_or(&id)
            .to_owned(),
        language: string(payload, "Shell").unwrap_or("sh").to_owned(),
        run_as: string(payload, "Permission").unwrap_or("user").to_owned(),
        timeout_seconds: integer(payload, "Timeout").unwrap_or(300),
        environment: environment.into_values().collect(),
        trigger: Trigger::from_payload(&trigger_type, interval_seconds, cron_expression),
        run_id,
        id,
        body,
        server_url,
        device_token,
    })
}

/// Profiles delivered before `SecretEnvironment` existed relied on this name
/// heuristic.
fn looks_secret(name: &str) -> bool {
    let upper = name.to_uppercase();

    upper.contains("SECRET") || upper.contains("TOKEN") || upper.contains("PASSWORD")
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

#[cfg(target_os = "macos")]
fn installed_profile_identifiers() -> Vec<String> {
    let Some(output) = run_profiles(&["-P", "-o", "stdout-xml"]) else {
        return Vec::new();
    };
    let Ok(plist) = plist::from_bytes::<Value>(&output) else {
        return Vec::new();
    };

    plist
        .as_dictionary()
        .and_then(|plist| plist.get("_computerlevel"))
        .and_then(Value::as_array)
        .map(|profiles| {
            profiles
                .iter()
                .filter_map(|profile| string(profile, "ProfileIdentifier").map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn profile_contents(identifier: &str) -> Option<Value> {
    let output = run_profiles(&["-P", "-p", identifier, "-o", "stdout-xml"])?;

    plist::from_bytes::<Value>(&output).ok()
}

#[cfg(target_os = "macos")]
fn run_profiles(arguments: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new("/usr/bin/profiles")
        .args(arguments)
        .output()
        .ok()?;

    if output.status.success() {
        Some(output.stdout)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trigger::TriggerKind;

    const PROFILE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.mattrax.script</string>
      <key>PayloadDisplayName</key><string>Rotate logs</string>
      <key>ScriptID</key><string>script-1</string>
      <key>Content</key><string>echo hi</string>
      <key>Shell</key><string>bash</string>
      <key>Permission</key><string>root</string>
      <key>Timeout</key><integer>120</integer>
      <key>Triggers</key>
      <array><dict><key>Type</key><string>timer</string><key>TimerInterval</key><integer>900</integer></dict></array>
      <key>Environment</key>
      <dict>
        <key>API_TOKEN</key><string>t0ken</string>
        <key>REGION</key><string>eu</string>
      </dict>
      <key>SecretEnvironment</key>
      <array><string>REGION</string></array>
      <key>RunID</key><string></string>
      <key>ServerURL</key><string>https://mattrax.test/</string>
      <key>DeviceToken</key><string>device-token</string>
    </dict>
    <dict>
      <key>PayloadType</key><string>com.apple.something-else</string>
    </dict>
  </array>
</dict>
</plist>"#;

    fn profile() -> Value {
        plist::from_bytes(PROFILE.as_bytes()).expect("profile parses")
    }

    #[test]
    fn parses_a_script_payload_and_ignores_other_payloads() {
        let scripts = scripts_from_profile(&profile());

        assert_eq!(scripts.len(), 1);

        let script = &scripts[0];
        assert_eq!(script.id, "script-1");
        assert_eq!(script.name, "Rotate logs");
        assert_eq!(script.language, "bash");
        assert_eq!(script.run_as, "root");
        assert_eq!(script.timeout_seconds, 120);
        assert_eq!(script.run_id, None);
        assert_eq!(script.server_url, "https://mattrax.test/");
        assert_eq!(script.trigger.kind, TriggerKind::Interval);
        assert_eq!(script.trigger.interval_seconds, Some(900));
    }

    #[test]
    fn applies_secret_flags_and_the_name_heuristic() {
        let scripts = scripts_from_profile(&profile());
        let environment = &scripts[0].environment;

        let token = environment
            .iter()
            .find(|entry| entry.name == "API_TOKEN")
            .expect("token entry");
        let region = environment
            .iter()
            .find(|entry| entry.name == "REGION")
            .expect("region entry");

        // The heuristic flags TOKEN even though SecretEnvironment lists REGION.
        assert!(token.secret);
        assert!(region.secret);
        // Sorted for a stable digest.
        assert_eq!(
            environment
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["API_TOKEN", "REGION"]
        );
    }

    #[test]
    fn defaults_are_the_swift_defaults() {
        let minimal = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.mattrax.script</string>
<key>ScriptID</key><string>s</string>
<key>Content</key><string>true</string>
<key>ServerURL</key><string>https://example.test</string>
<key>DeviceToken</key><string>t</string>
</dict></array></dict></plist>"#;
        let value: Value = plist::from_bytes(minimal.as_bytes()).expect("profile parses");
        let scripts = scripts_from_profile(&value);
        let script = &scripts[0];

        assert_eq!(script.name, "s");
        assert_eq!(script.language, "sh");
        assert_eq!(script.run_as, "user");
        assert_eq!(script.timeout_seconds, 300);
        assert_eq!(script.trigger.kind, TriggerKind::Install);
        assert_eq!(script.run_id, None);
        assert!(script.environment.is_empty());
    }

    #[test]
    fn missing_required_fields_skip_the_payload() {
        let missing_token = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.mattrax.script</string>
<key>ScriptID</key><string>s</string>
<key>Content</key><string>true</string>
<key>ServerURL</key><string>https://example.test</string>
</dict></array></dict></plist>"#;
        let value: Value = plist::from_bytes(missing_token.as_bytes()).expect("profile parses");

        assert!(scripts_from_profile(&value).is_empty());
    }
}
