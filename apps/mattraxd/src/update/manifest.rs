//! The release manifest and its verification rules.
//!
//! Exact format (also documented in `apps/mattraxd/README.md`):
//!
//! ```json
//! {
//!   "schema": 1,
//!   "channel": "stable",
//!   "version": "1.1.0",
//!   "releasedAt": "2026-11-20T00:00:00Z",
//!   "signature": "base64 ed25519 signature over the canonical payload",
//!   "artifacts": {
//!     "macos-aarch64": {
//!       "url": "https://…/mattraxd-1.1.0-macos-universal",
//!       "sha256": "64 lowercase hex characters",
//!       "size": 1234567
//!     }
//!   }
//! }
//! ```
//!
//! The signed payload is the compact JSON serialisation of the same object
//! without `signature`, with the fixed field order above and artifacts sorted
//! by platform name. The agent rebuilds those exact bytes from the parsed
//! manifest, so whitespace and formatting of the published file are free.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

pub const SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    pub url: String,
    pub sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    pub channel: String,
    pub version: String,
    pub released_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    pub artifacts: BTreeMap<String, Artifact>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnsignedManifest<'a> {
    schema: u32,
    channel: &'a str,
    version: &'a str,
    released_at: &'a str,
    artifacts: &'a BTreeMap<String, Artifact>,
}

impl Manifest {
    /// Bytes the signature covers. Must stay in sync with the release tool.
    pub fn signing_payload(&self) -> Vec<u8> {
        serde_json::to_vec(&UnsignedManifest {
            schema: self.schema,
            channel: &self.channel,
            version: &self.version,
            released_at: &self.released_at,
            artifacts: &self.artifacts,
        })
        .expect("manifest serialisation cannot fail")
    }

    pub fn sign(&mut self, key: &SigningKey) {
        let signature = key.sign(&self.signing_payload());

        self.signature = Some(STANDARD.encode(signature.to_bytes()));
    }

    /// Fail closed. `public_key` is `None` only for builds compiled without a
    /// key; those verify the checksum and accept the transport's integrity.
    pub fn verify_signature(&self, public_key: Option<&VerifyingKey>) -> Result<(), UpdateError> {
        let Some(public_key) = public_key else {
            return Ok(());
        };

        let signature = self.signature.as_deref().ok_or_else(|| {
            UpdateError::Signature(
                "manifest is unsigned but this build requires a signature".into(),
            )
        })?;
        let bytes = STANDARD.decode(signature).map_err(|error| {
            UpdateError::Signature(format!("signature is not valid base64: {error}"))
        })?;
        let signature = Signature::from_slice(&bytes).map_err(|error| {
            UpdateError::Signature(format!("signature has the wrong length: {error}"))
        })?;

        public_key
            .verify_strict(&self.signing_payload(), &signature)
            .map_err(|_| UpdateError::Signature("manifest signature does not verify".into()))
    }

    /// Structural and transport checks. Runs before the signature so a broken
    /// manifest never reaches the download step.
    pub fn validate(&self, allow_insecure_urls: bool) -> Result<(), UpdateError> {
        if self.schema != SCHEMA {
            return Err(UpdateError::Manifest(format!(
                "unsupported manifest schema {} (expected {SCHEMA})",
                self.schema
            )));
        }

        if self.channel.trim().is_empty() {
            return Err(UpdateError::Manifest("manifest has no channel".into()));
        }

        semver::Version::parse(&self.version)
            .map_err(|error| UpdateError::Manifest(format!("invalid version: {error}")))?;

        if self.released_at.trim().is_empty() {
            return Err(UpdateError::Manifest("manifest has no releasedAt".into()));
        }

        if self.artifacts.is_empty() {
            return Err(UpdateError::Manifest("manifest has no artifacts".into()));
        }

        for (platform, artifact) in &self.artifacts {
            if !is_sha256(&artifact.sha256) {
                return Err(UpdateError::Manifest(format!(
                    "artifact {platform} has an invalid sha256"
                )));
            }

            let secure = artifact.url.starts_with("https://");
            let insecure = artifact.url.starts_with("http://");

            if !secure && !(allow_insecure_urls && insecure) {
                return Err(UpdateError::Manifest(format!(
                    "artifact {platform} must use https"
                )));
            }
        }

        Ok(())
    }
}

pub fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub fn public_key_from_hex(value: &str) -> Result<VerifyingKey, UpdateError> {
    let trimmed = value.trim();
    let trimmed = trimmed.strip_prefix("ed25519:").unwrap_or(trimmed);
    let bytes = decode_hex(trimmed)
        .ok_or_else(|| UpdateError::Signature("public key is not 64 hex characters".into()))?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| UpdateError::Signature("public key is not 32 bytes".into()))?;

    VerifyingKey::from_bytes(&bytes)
        .map_err(|error| UpdateError::Signature(format!("public key is invalid: {error}")))
}

pub fn signing_key_from_hex(value: &str) -> Result<SigningKey, UpdateError> {
    let trimmed = value.trim();
    let trimmed = trimmed.strip_prefix("ed25519:seed:").unwrap_or(trimmed);
    let bytes = decode_hex(trimmed)
        .ok_or_else(|| UpdateError::Signature("signing key is not 64 hex characters".into()))?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| UpdateError::Signature("signing key is not 32 bytes".into()))?;

    Ok(SigningKey::from_bytes(&bytes))
}

pub fn public_key_hex(key: &VerifyingKey) -> String {
    key.to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.len() % 2 != 0 {
        return None;
    }

    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateError {
    Manifest(String),
    Signature(String),
    Checksum { expected: String, actual: String },
    Http(String),
    Io(String),
    Platform(String),
    Downgrade { current: String, remote: String },
    Restart(String),
}

impl fmt::Display for UpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Manifest(message) => write!(formatter, "invalid manifest: {message}"),
            Self::Signature(message) => {
                write!(formatter, "signature verification failed: {message}")
            }
            Self::Checksum { expected, actual } => {
                write!(
                    formatter,
                    "checksum mismatch: expected {expected}, got {actual}"
                )
            }
            Self::Http(message) => write!(formatter, "download failed: {message}"),
            Self::Io(message) => write!(formatter, "filesystem error: {message}"),
            Self::Platform(message) => write!(formatter, "unsupported platform: {message}"),
            Self::Downgrade { current, remote } => write!(
                formatter,
                "refusing to downgrade from {current} to {remote}; pass --force to allow it"
            ),
            Self::Restart(message) => write!(
                formatter,
                "the update installed but restarting failed: {message}"
            ),
        }
    }
}

impl std::error::Error for UpdateError {}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: [u8; 32] = [7u8; 32];

    fn manifest() -> Manifest {
        Manifest {
            schema: SCHEMA,
            channel: "stable".into(),
            version: "1.1.0".into(),
            released_at: "2026-11-20T00:00:00Z".into(),
            signature: None,
            artifacts: BTreeMap::from([
                (
                    "macos-aarch64".into(),
                    Artifact {
                        url: "https://example.test/mattraxd-macos".into(),
                        sha256: "a".repeat(64),
                        size: Some(42),
                    },
                ),
                (
                    "windows-x86_64".into(),
                    Artifact {
                        url: "https://example.test/mattraxd.exe".into(),
                        sha256: "b".repeat(64),
                        size: None,
                    },
                ),
            ]),
        }
    }

    #[test]
    fn signing_round_trips_and_covers_the_whole_manifest() {
        let key = SigningKey::from_bytes(&SEED);
        let public = key.verifying_key();
        let mut manifest = manifest();

        manifest.sign(&key);
        assert!(manifest.verify_signature(Some(&public)).is_ok());

        manifest.version = "9.9.9".into();
        assert!(matches!(
            manifest.verify_signature(Some(&public)),
            Err(UpdateError::Signature(_))
        ));
    }

    #[test]
    fn unsigned_manifests_fail_when_a_key_is_configured() {
        let key = SigningKey::from_bytes(&SEED);
        let manifest = manifest();

        assert!(manifest.verify_signature(None).is_ok());
        assert!(matches!(
            manifest.verify_signature(Some(&key.verifying_key())),
            Err(UpdateError::Signature(_))
        ));
    }

    #[test]
    fn a_tampered_artifact_breaks_the_signature() {
        let key = SigningKey::from_bytes(&SEED);
        let mut manifest = manifest();
        manifest.sign(&key);

        manifest.artifacts.get_mut("macos-aarch64").unwrap().sha256 = "c".repeat(64);

        assert!(manifest
            .verify_signature(Some(&key.verifying_key()))
            .is_err());
    }

    #[test]
    fn payload_is_stable_across_serialisation() {
        let key = SigningKey::from_bytes(&SEED);
        let mut manifest = manifest();
        manifest.sign(&key);
        let payload = manifest.signing_payload();

        let json = serde_json::to_string_pretty(&manifest).unwrap();
        let parsed: Manifest = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.signing_payload(), payload);
        assert!(parsed.verify_signature(Some(&key.verifying_key())).is_ok());
    }

    #[test]
    fn validates_schema_checksums_and_transport() {
        let manifest = manifest();
        assert!(manifest.validate(false).is_ok());

        let mut bad_schema = manifest.clone();
        bad_schema.schema = 2;
        assert!(bad_schema.validate(false).is_err());

        let mut bad_hash = manifest.clone();
        bad_hash.artifacts.get_mut("macos-aarch64").unwrap().sha256 = "not-a-hash".into();
        assert!(bad_hash.validate(false).is_err());

        let mut insecure = manifest;
        insecure.artifacts.get_mut("macos-aarch64").unwrap().url =
            "http://example.test/mattraxd".into();
        assert!(insecure.validate(false).is_err());
        assert!(insecure.validate(true).is_ok());
    }

    #[test]
    fn keys_round_trip_through_hex() {
        let key = SigningKey::from_bytes(&SEED);
        let hex = public_key_hex(&key.verifying_key());

        assert_eq!(
            public_key_from_hex(&hex).unwrap().to_bytes(),
            key.verifying_key().to_bytes()
        );
        assert_eq!(
            signing_key_from_hex(&format!("{}{}", "07".repeat(32), ""))
                .unwrap()
                .verifying_key()
                .to_bytes(),
            key.verifying_key().to_bytes()
        );
    }
}
