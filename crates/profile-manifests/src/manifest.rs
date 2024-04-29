use plist::{Date, Value};
use serde::Deserialize;

// We treat <integer /> as u64.
// From what I can tell this is the max for `NSNumber`.

/// The manifest for a profile.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Manifest {
    /// Should contain a URL to the download page of the application it's configuring.
    pub pfm_app_url: Option<String>,
    /// Should contain a URL to the documentation of the keys this application supports. (And from where you have taken the information to create this manifest)
    pub pfm_documentation_url: Option<String>,
    /// Scope where this payload is valid.
    /// If this payload is only for iOS and tvOS this should be set to only system.
    ///  On macOS you include all scopes this payload is valid to install to.
    /// If this is not included, it will default to system AND user.
    pub pfm_targets: Vec<Target>,
    /// The platforms where this payload is valid.
    /// If this is not included, it will default to only macOS.
    pub pfm_platforms: Vec<Platform>,
    /// A description of the payload.
    pub pfm_description: String,
    /// The preference domain of the payload.
    /// This should be the same as PayloadType in the pfm_subkeys.
    pub pfm_domain: String,
    /// The format version is used by the application to know it can support all manifest keys in this manifest.
    /// Sometimes new keys are added, but those will not be supported by older versions of the application.
    /// To avoid creating invalid payloads because of that, the app will not load manifests with newer format versions that it can support.
    /// See this page for the current versions: https://github.com/erikberglund/ProfileManifests/wiki/Manifest-Format-Versions
    pub pfm_format_version: u64,
    /// Date the manifest was last modified. This is used for manifest collision.
    /// Read more about that here: https://github.com/erikberglund/ProfileManifests/wiki/Manifest-Collision
    pub pfm_last_modified: Date,
    /// The title of the manifest
    pub pfm_title: String,
    /// This determines if there can be more than one payload in the profile for this PayloadType
    pub pfm_unique: bool,
    /// The version number of this manifest, it's used to determine which manifest to load if two manifests with identical "pfm_domain" is found
    pub pfm_version: u64,
    /// An array of all keys this payload can configure. They will be shown in order
    pub pfm_subkeys: Vec<Subkey>,
}

/// A key which can be configured in this payload.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Subkey {
    /// Configures Example Application configuration preferences
    pub pfm_default: Option<Value>,
    /// Description of the payload.
    pub pfm_description: Option<String>,
    /// A human-readable description of this payload. This description is shown on the Detail screen.
    pub pfm_description_reference: Option<String>,
    /// PayloadDescription
    pub pfm_name: String,
    /// Payload Description
    pub pfm_title: Option<String>,
    /// type
    pub pfm_type: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    System,
    User,
}

#[derive(Debug, Default, Clone, PartialEq, Deserialize)]
pub enum Platform {
    #[default]
    #[serde(rename = "macOS")]
    MacOS,
}
