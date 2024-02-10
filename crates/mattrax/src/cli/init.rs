use std::{fs, path::PathBuf};

use rcgen::{BasicConstraints, Certificate, CertificateParams, DnType, IsCa, KeyUsagePurpose};
use tracing::warn;

use crate::config;

#[derive(clap::Args)]
#[command(about = "Initialise a new Mattrax installation.")]
pub struct Command {}

impl Command {
    pub fn run(&self, data_dir: PathBuf) {
        fs::create_dir_all(&data_dir).unwrap();

        let mut secret = [0u8; 32];
        getrandom::getrandom(&mut secret).unwrap();

        // TODO: Go through all params
        // TODO: This keypair is tiny compared to the old stuff, why is that????
        let mut params = CertificateParams::new(vec![]);
        params
            .distinguished_name
            .push(DnType::OrganizationName, "Mattrax");
        params
            .distinguished_name
            .push(DnType::CommonName, "Mattrax Device Authority");
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained); // TODO: critical: true
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign]; // TODO: critical: true

        let cert = Certificate::from_params(params).unwrap();
        let certs_dir = data_dir.join("certs");
        fs::create_dir_all(&certs_dir).unwrap();

        fs::write(
            certs_dir.join("identity.der"),
            cert.serialize_der().unwrap(),
        )
        .unwrap();
        fs::write(
            certs_dir.join("identity-key.der"),
            cert.serialize_private_key_der(),
        )
        .unwrap();
        fs::write(
            certs_dir.join("identity.pool"),
            cert.serialize_pem().unwrap(),
        )
        .unwrap();

        let acme_server = if cfg!(debug_assertions) {
            config::AcmeServer::Staging
        } else {
            config::AcmeServer::Production
        };

        let domain = if cfg!(debug_assertions) {
            "localhost".to_string()
        } else {
            "mdm.mattrax.app".to_string()
        };

        let config = config::Config {
            domain,
            acme_email: "hello@mattrax.app".to_string(),
            acme_server,
            secret,
        };

        fs::write(
            data_dir.join("config.json"),
            serde_json::to_string(&config).unwrap(),
        )
        .unwrap();

        // TODO: This is for self-hosting
        // TODO: Steal code from https://github.com/oscartbeaumont/Mattrax/blob/main/src/cmd/init.rs
        warn!("Initialised. Proper setup process coming soon...");
    }
}
