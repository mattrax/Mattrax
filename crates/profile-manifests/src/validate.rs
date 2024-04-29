use phf::phf_map;
use thiserror::Error;

use crate::Manifest;

static REQUIRED_PROPERTIES: phf::Map<&'static str, &'static str> = phf_map! {
    "PayloadDescription" => "string",
    "PayloadDisplayName" => "string",
    "PayloadIdentifier" => "string",
    "PayloadType" => "string",
    "PayloadUUID" => "string",
    "PayloadVersion" => "integer",
    "PayloadOrganization" => "string",
};

/// Validate a manifest has the minimum required keys.
pub fn validate_manifest(manifest: &Manifest) -> Vec<Error> {
    let mut errors = Vec::new();
    let mut found = Vec::with_capacity(REQUIRED_PROPERTIES.len());

    for key in &manifest.pfm_subkeys {
        if let Some(expected_ty) = REQUIRED_PROPERTIES.get(&key.pfm_name) {
            found.push(key.pfm_name.clone());
            if key.pfm_type != *expected_ty {
                errors.push(Error::RequiredPropertyInvalidType {
                    key: key.pfm_name.clone(),
                    expected: expected_ty.to_string(),
                    found: key.pfm_type.clone(),
                });
            }
        }
    }

    for (key, _) in &REQUIRED_PROPERTIES {
        if !found.iter().find(|&x| x == key).is_some() {
            errors.push(Error::MissingRequiredProperty {
                key: key.to_string(),
            });
        }
    }

    errors
}

#[derive(Error, Debug)]
pub enum Error {
    #[error("Missing {key} key in manifest")]
    MissingRequiredProperty { key: String },
    #[error("Expected {key} with type {expected} found {found}")]
    RequiredPropertyInvalidType {
        key: String,
        expected: String,
        found: String,
    },
}
