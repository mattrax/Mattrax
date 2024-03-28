use serde::{Deserialize, Serialize};
use specta::Type;

use crate::{
    android::AndroidConfiguration, apple::AppleConfiguration, script::Script,
    windows::WindowsConfiguration,
};

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Configuration {
    /// Windows-specific configurations
    Windows(WindowsConfiguration),
    /// Apple-specific configurations
    Apple(AppleConfiguration),
    /// Android-specific configurations
    Android(AndroidConfiguration),
    /// Script to run via `mattraxd`
    Script(Script),
}

// TODO: WiFi
// TODO: Wallpaper, dock/taskbar
// TODO: Managing OS updates
// TODO: Lockscreen and screensaver options

// TODO: Chromium, Edge, Brave, Firefox, Safari
// TODO: Slack - https://slack.com/intl/en-au/help/articles/11906214948755-Manage-desktop-app-configurations
