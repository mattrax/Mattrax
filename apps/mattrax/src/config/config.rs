use serde::{Deserialize, Serialize};

/// Configuration for a Mattrax installation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Config {
    /// The domain where Mattrax is hosted.
    pub domain: String,
    /// The domain to use for Windows MDM enrollment.
    /// This should be `enterpriseenrollment.{domain}`
    pub enrollment_domain: String,
    /// Configure the email to use for ACME updates.
    pub acme_email: String,
    /// Configure the Let's Encrypt ACME server to use.
    #[serde(default, skip_serializing_if = "AcmeServer::is_default")]
    pub acme_server: AcmeServer,
    /// Secret used to secure direct communications between JS backend and Rust backend.
    /// This should be set as the 'INTERNAL_SECRET' environment variable of the JS backend.
    pub internal_secret: String,
    /// Certificates
    pub certificates: Certificates,
    /// Desired version of Mattrax.
    /// This is used to coordinate updates across multiple nodes.
    pub desired_version: String,
    /// Options for deploying Mattrax at scale (Eg. cloud.mattrax.app)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud: Option<CloudConfig>,
}

/// Different certificates used by Mattrax.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Certificates {
    /// The public key for the active identity certificate.
    #[serde(with = "mx_utils::serde_with_hex")]
    pub identity_cert: Vec<u8>,
    /// The private key for the active identity certificate.
    #[serde(with = "mx_utils::serde_with_hex")]
    pub identity_key: Vec<u8>,
    /// Any expired or near-expiry identity certificates which Mattrax should continue to accept but not use for new enrollments.
    pub identity_pool: Vec<String>,
}

/// Configuration properties for when deploying Mattrax at scale. (Eg. cloud.mattrax.app)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CloudConfig {
    // Domain for the frontend. Falls back to `Config::domain` if not set.
    pub frontend: Option<String>,
}

/// Configure the Let's Encrypt ACME server to use.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcmeServer {
    #[default]
    Production,
    Staging,
}

impl AcmeServer {
    fn is_default(&self) -> bool {
        matches!(self, Self::Production)
    }

    pub fn into_better_acme_server(&self) -> better_acme::Server {
        match self {
            Self::Production => better_acme::Server::LetsEncrypt,
            Self::Staging => better_acme::Server::LetsEncryptStaging,
        }
    }
}
