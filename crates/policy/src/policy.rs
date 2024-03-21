use serde::{Deserialize, Serialize};
use specta::Type;

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Policy {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(default)]
    pub configuration: Vec<Configuration>,
}

/// TODO
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Configuration {
    /// TODO
    WindowsCustom {
        // TODO: Properly account for the different types
        oma_uri: String,
        data: String,
    },
    /// TODO
    AppleCustom {
        // TODO: `path` properly shouldn't exist here but should be possible with the CLI only
        path: String,
        // raw: String,
    },
}
