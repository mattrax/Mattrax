use serde::{Deserialize, Serialize};
use specta::Type;

use crate::Platform;

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Script {
    pub shell: Shell,
    #[serde(default)]
    pub supported: Vec<Platform>,
    #[serde(default)]
    pub trigger: Trigger,
    pub run: String,
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Shell {
    Powershell,
    Bash,
    Zsh,
}

/// TODO
#[derive(Default, Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Trigger {
    /// Only run the script once. If you modify the script it will run again.
    #[default]
    Once,
    /// Trigger anytime a user logs in
    Login,
    /// Trigger anytime a user logs out
    Logout,
    /// Trigger anytime a device starts up
    Startup,
    /// Trigger anytime the network state changes
    NetworkStateChange,
    /// Trigger after the device has been enrolled.
    EnrollmentComplete,
    /// Trigger every time the device talks with Mattrax.
    Checkin,
}
