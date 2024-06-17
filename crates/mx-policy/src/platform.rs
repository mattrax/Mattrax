use serde::{Deserialize, Serialize};
use specta::Type;

/// Define the platforms that are supported by Mattrax.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum Platform {
    #[serde(rename = "windows")]
    Windows,
    #[serde(rename = "macOS")]
    MacOS,
    #[serde(rename = "iOS")]
    Ios,
    #[serde(rename = "iPadOS")]
    IPadOS,
    #[serde(rename = "tvOS")]
    TvOS,
    #[serde(rename = "watchOS")]
    WatchOS,
    #[serde(rename = "linux")]
    Linux,
    #[serde(rename = "android")]
    Android,
    #[serde(rename = "ChromeOS")]
    ChromeOS,
}

impl Platform {
    pub fn to_string(&self) -> &'static str {
        match self {
            Platform::Windows => "Windows",
            Platform::MacOS => "macOS",
            Platform::Ios => "iOS",
            Platform::IPadOS => "iPadOS",
            Platform::TvOS => "tvOS",
            Platform::WatchOS => "watchOS",
            Platform::Linux => "Linux",
            Platform::Android => "Android",
            Platform::ChromeOS => "ChromeOS",
        }
    }
}
