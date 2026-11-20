//! Host context sampled once per tick: boot marker, console user and network
//! fingerprint. All three are empty off macOS, so no session or network
//! trigger can fire there.

use crate::util::fnv1a64_hex;
#[cfg(target_os = "macos")]
use std::process::Command;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostContext {
    pub boot_time: String,
    pub console_user: String,
    pub network_hash: String,
}

pub fn collect() -> HostContext {
    HostContext {
        boot_time: boot_time(),
        console_user: console_user(),
        network_hash: network_hash(),
    }
}

#[cfg(target_os = "macos")]
pub fn boot_time() -> String {
    command_stdout("/usr/sbin/sysctl", &["-n", "kern.boottime"]).unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub fn boot_time() -> String {
    String::new()
}

#[cfg(target_os = "macos")]
pub fn console_user() -> String {
    let Some(raw) = command_stdout("/usr/bin/stat", &["-f", "%Su", "/dev/console"]) else {
        return String::new();
    };

    normalise_console_user(&raw)
}

#[cfg(not(target_os = "macos"))]
pub fn console_user() -> String {
    String::new()
}

/// `root` and `loginwindow` mean nobody is logged in: the console is owned by
/// the system.
pub fn normalise_console_user(raw: &str) -> String {
    let name = raw.trim();

    if name == "root" || name == "loginwindow" {
        String::new()
    } else {
        name.to_owned()
    }
}

#[cfg(target_os = "macos")]
pub fn console_uid(name: &str) -> Option<u32> {
    if name.is_empty() {
        return None;
    }

    command_stdout("/usr/bin/id", &["-u", name]).and_then(|value| value.trim().parse().ok())
}

#[cfg(not(target_os = "macos"))]
pub fn console_uid(_name: &str) -> Option<u32> {
    None
}

#[cfg(target_os = "macos")]
pub fn network_hash() -> String {
    command_stdout_raw("/sbin/ifconfig", &[])
        .map(|output| network_hash_of(&output))
        .unwrap_or_else(|| network_hash_of(&[]))
}

#[cfg(not(target_os = "macos"))]
pub fn network_hash() -> String {
    // A stable non-empty value keeps the state file shape valid off macOS.
    network_hash_of(&[])
}

pub fn network_hash_of(interfaces: &[u8]) -> String {
    fnv1a64_hex(interfaces)
}

/// The daemon must run as root to execute a `root` script. Windows services
/// run as SYSTEM, so the check only applies on Unix.
pub fn is_elevated() -> bool {
    #[cfg(unix)]
    {
        // SAFETY: geteuid has no preconditions and cannot fail.
        unsafe { libc::geteuid() == 0 }
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(target_os = "macos")]
fn command_stdout(program: &str, arguments: &[&str]) -> Option<String> {
    command_stdout_raw(program, arguments)
        .map(|output| String::from_utf8_lossy(&output).into_owned())
}

#[cfg(target_os = "macos")]
fn command_stdout_raw(program: &str, arguments: &[&str]) -> Option<Vec<u8>> {
    let output = Command::new(program).args(arguments).output().ok()?;

    if output.status.success() {
        Some(output.stdout)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn console_user_rejects_system_owners() {
        assert_eq!(normalise_console_user("alice\n"), "alice");
        assert_eq!(normalise_console_user(" root "), "");
        assert_eq!(normalise_console_user("loginwindow\n"), "");
    }

    #[test]
    fn network_hash_is_stable_and_sensitive() {
        assert_eq!(
            network_hash_of(b"en0: 10.0.0.2"),
            network_hash_of(b"en0: 10.0.0.2")
        );
        assert_ne!(
            network_hash_of(b"en0: 10.0.0.2"),
            network_hash_of(b"en0: 10.0.0.3")
        );
    }
}
