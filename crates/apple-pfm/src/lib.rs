use std::path::Path;

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
    /// On macOS you include all scopes this payload is valid to install to.
    /// If this is not included, it will default to system AND user.
    #[serde(default)]
    pub pfm_targets: Vec<Target>,
    /// The platforms where this payload is valid.
    /// If this is not included, it will default to only macOS.
    #[serde(default)]
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
    pub pfm_unique: Option<bool>,
    /// The version number of this manifest, it's used to determine which manifest to load if two manifests with identical "pfm_domain" is found
    pub pfm_version: u64,
    /// An array of all keys this payload can configure. They will be shown in order
    pub pfm_subkeys: Vec<Preference>,
    pub pfm_supervised: Option<bool>,
}

impl Manifest {
    pub fn from_file(path: impl AsRef<Path>) -> Self {
        dbg!(path.as_ref());
        plist::from_file(path).unwrap()
    }
}

/// A key which can be configured in this payload.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct PreferenceBase {
    pub pfm_default: Option<Value>,
    pub pfm_description: Option<String>,
    pub pfm_description_reference: Option<String>,
    pub pfm_title: Option<String>,
    pub pfm_name: Option<String>,
    pub pfm_supervised: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "pfm_type", rename_all = "lowercase")]
pub enum Preference {
    Array {
        #[serde(flatten)]
        base: PreferenceBase,
        #[serde(default)]
        pfm_subkeys: Vec<Preference>,
    },
    Boolean(PreferenceBase),
    Date(PreferenceBase),
    Data(PreferenceBase),
    Dictionary {
        #[serde(flatten)]
        base: PreferenceBase,
        #[serde(default)]
        pfm_subkeys: Vec<Preference>,
    },
    Integer(PreferenceBase),
    Real(PreferenceBase),
    Float(PreferenceBase),
    String(PreferenceBase),
    Url(PreferenceBase),
    Alias(PreferenceBase),
    UnionPolicy(PreferenceBase),
}

impl std::ops::Deref for Preference {
    type Target = PreferenceBase;

    fn deref(&self) -> &Self::Target {
        match self {
            Preference::Array { base, .. } => base,
            Preference::Boolean(p) => p,
            Preference::Date(p) => p,
            Preference::Data(p) => p,
            Preference::Dictionary { base, .. } => base,
            Preference::Integer(p) => p,
            Preference::Real(p) => p,
            Preference::Float(p) => p,
            Preference::String(p) => p,
            Preference::Url(p) => p,
            Preference::Alias(p) => p,
            Preference::UnionPolicy(p) => p,
        }
    }
}

impl Preference {
    pub fn pfm_type(&self) -> &str {
        match self {
            Preference::Array { .. } => "array",
            Preference::Boolean(_) => "boolean",
            Preference::Date(_) => "date",
            Preference::Data(_) => "data",
            Preference::Dictionary { .. } => "dictionary",
            Preference::Integer(_) => "integer",
            Preference::Real(_) => "real",
            Preference::Float(_) => "float",
            Preference::String(_) => "string",
            Preference::Url(_) => "url",
            Preference::Alias(_) => "alias",
            Preference::UnionPolicy(_) => "union policy",
        }
    }
}

// #[derive(Debug, Clone, PartialEq, Deserialize)]
// pub struct ArrayPreference {
//     pub pfm_title: Option<String>,
//     pub pfm_name: Option<String>,
//     pub pfm_description: Option<String>,
//     pub pfm_description_reference: Option<String>,
//     #[serde(flatten)]
//     pub r#type: Preference,
// }

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
    #[serde(rename = "iOS")]
    Ios,
    #[serde(rename = "tvOS")]
    TvOs,
}
