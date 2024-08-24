use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
    process,
};

use mx_db::Db;
use rcgen::{
    BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, KeyUsagePurpose,
    PKCS_ECDSA_P256_SHA256,
};
use tracing::{error, info, warn};

use crate::{
    cli::serve::{binary_name, helpers},
    config::{self, Certificates, CloudConfig, Config, LocalConfig},
};

#[derive(clap::Args)]
#[command(about = "Initialise a new Mattrax server or installation.")]
pub struct Command {
    #[arg(help = "The URL to the MySQL database.")]
    db: Option<String>,
}

impl Command {
    pub async fn run(&self, data_dir: PathBuf) {
        if data_dir.join("config.json").exists() {
            error!(
                "Mattrax is already initialised, found 'config.json'. Run `{} serve` to get started!",
                binary_name()
            );
            return;
        }

        warn!("Mattrax does not officially support self-hosting at this time. Do so at your own risk!");

        let db_url = self.db.clone().unwrap_or_else(|| {
            println!("Enter the MySQL database URL (eg. mysql://user:password@localhost/mattrax):");
            print!(" > ");
            io::stdout().flush().ok();
            let mut db_url = String::new();
            while db_url.is_empty() {
                io::stdin().read_line(&mut db_url).unwrap();
                if db_url.trim().is_empty() {
                    error!("Database URL cannot be empty!");
                }
            }
            db_url.trim().to_string()
        });

        let (db, config) = helpers::get_db_and_config(&db_url).await;
        if let Some(config) = config {
            info!("Found Mattrax installation for '{}'", config.domain);
        } else {
            info!("Initialising new Mattrax installation...");

            let mut secret: [u8; 32] = rand::random();

            let (domain, enrollment_domain) = if cfg!(debug_assertions) {
                (
                    "localhost".to_string(),
                    "enterpriseenrollment.localhost".to_string(), // TODO: this is invalid but ehhh
                )
            } else {
                (
                    "mdm.mattrax.app".to_string(),
                    "enterpriseenrollment.mattrax.app".to_string(),
                )
            };

            do_setup(&db, domain, enrollment_domain, None, hex::encode(secret)).await;
        }

        fs::create_dir_all(&data_dir).unwrap();
        let Ok(_) = LocalConfig {
            db_url: db_url.to_string(),
        }
        .save(data_dir.join("config.json"))
        .map_err(|err| error!("Failed to save local configuration: {err}")) else {
            process::exit(1);
        };

        info!(
            "Initialised installation! Run '{} serve' to start the server.",
            binary_name()
        );
    }
}

pub(super) async fn do_setup(
    db: &Db,
    domain: String,
    enrollment_domain: String,
    cloud: Option<CloudConfig>,
    internal_secret: String,
) -> Config {
    // TODO: Go through all params
    // TODO: This keypair is tiny compared to the old stuff, why is that????
    let mut params = CertificateParams::new(vec![]).unwrap();
    params
        .distinguished_name
        .push(DnType::OrganizationName, "Mattrax");
    params
        .distinguished_name
        .push(DnType::CommonName, "Mattrax Device Authority");
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained); // TODO: critical: true
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign]; // TODO: critical: true

    let key_pair = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
    let cert = params.self_signed(&key_pair).unwrap();

    let config = config::Config {
        domain,
        enrollment_domain,
        internal_secret,
        certificates: Certificates {
            identity_cert: cert.der().to_vec(),
            identity_key: key_pair.serialize_der(),
            identity_pool: vec![cert.pem()],
        },
        cloud,
    };

    db.set_config(serde_json::to_string(&config).unwrap())
        .await
        .map_err(|err| error!("Failed to set Mattrax configuration in DB: {err}"))
        .unwrap();

    config
}
