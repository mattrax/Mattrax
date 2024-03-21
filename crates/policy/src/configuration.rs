use serde::{Deserialize, Serialize};
use specta::Type;

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Configuration {
    /// TODO
    WindowsCustom {
        // TODO: Properly account for the different types
        oma_uri: String,
        value: String, // TODO: Allow direct number types
    },
    /// TODO
    AppleCustom {
        // TODO: `path` properly shouldn't exist here but should be possible with the CLI only
        path: String,
        // raw: String,
    },

    /// TODO
    WiFi {
        // TODO: Enterprise WiFi's
    },

    // TODO: "Standard" browser policy
    /// TODO
    Chromium {},
    /// TODO
    Edge {},
    /// TODO
    Brave {},

    /// Configuration for Slack desktop app.
    /// Reference: https://slack.com/intl/en-au/help/articles/11906214948755-Manage-desktop-app-configurations
    Slack {
        /// TODO
        auto_update: Option<bool>, // TODO: This isn't supported on Linux
    },
}

// TODO: Wallpaper, dock/taskbar
// TODO: Managing OS updates
// TODO: Lockscreen and screensaver options
