//! Mattrax on-device agent.
//!
//! The agent reads installed `com.mattrax.script` configuration profiles,
//! evaluates their triggers, runs the script body and posts one terminal result
//! per run. Everything that does not need root or macOS is a pure function so
//! it can be tested on any host.

pub mod agent;
pub mod cron;
pub mod exec;
pub mod host;
pub mod logging;
pub mod profiles;
pub mod restricted;
pub mod result;
pub mod state;
pub mod trigger;
pub mod update;
pub mod util;

/// Package/build version embedded at compile time. `MATTRAXD_VERSION` lets a
/// release workflow stamp a nightly or prerelease without editing Cargo.toml.
pub const VERSION: &str = env!("MATTRAXD_VERSION");

/// Installed state. Contains trigger timestamps and manual run ids, never
/// script bodies or captured output.
pub const STATE_PATH: &str = "/var/lib/mattrax/mattraxd-state.json";
pub const LOG_PATH: &str = "/var/log/mattraxd.log";
pub const SCRIPT_PAYLOAD_TYPE: &str = "com.mattrax.script";
pub const RESTRICTED_SOFTWARE_PAYLOAD_TYPE: &str = "com.mattrax.restricted-software";

/// The server re-applies this cap; the device cap keeps a runaway script from
/// filling memory or the result body.
pub const OUTPUT_LIMIT: usize = 64 * 1024;
pub const OUTPUT_TRUNCATED_MARKER: &str = "\n[mattrax: output truncated]";

/// Launchd label and installed binary path. Shared by the plist, the pkg
/// postinstall script and `mattraxd update --restart`.
pub const LAUNCHD_LABEL: &str = "com.mattrax.mattraxd";
pub const INSTALLED_BINARY: &str = "/usr/local/libexec/mattraxd";
