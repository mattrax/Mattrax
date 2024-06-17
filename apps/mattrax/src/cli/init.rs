use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
    process,
};

use rcgen::{
    BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, KeyUsagePurpose,
    PKCS_ECDSA_P256_SHA256,
};
use tracing::{error, info, warn};

use crate::{
    cli::serve::{binary_name, helpers},
    config::{self, Certificates, LocalConfig, Node},
};

#[derive(clap::Args)]
#[command(about = "Initialise a new Mattrax server or installation.")]
pub struct Command {
    #[arg(help = "The URL to the MySQL database.")]
    db: Option<String>,
}

impl Command {
    pub async fn run(&self, data_dir: PathBuf) {
        let path = PathBuf::from("/run/systemd/system");
        let is_systemd_found = path.exists();

        if is_systemd_found && nix::unistd::geteuid().as_raw() != 0 {
            error!("Mattrax must not be run as root to install the systemd service.!");
            return;
        }

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

            let mut secret = [0u8; 32];
            getrandom::getrandom(&mut secret).unwrap();

            let acme_server = if cfg!(debug_assertions) {
                config::AcmeServer::Staging
            } else {
                config::AcmeServer::Production
            };

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

            let config = config::Config {
                domain,
                enrollment_domain,
                acme_email: "hello@mattrax.app".to_string(),
                acme_server,
                internal_secret: hex::encode(secret),
                desired_version: env!("GIT_HASH").to_string(),
                certificates: Certificates {
                    identity_cert: cert.der().to_vec(),
                    identity_key: key_pair.serialize_der(),
                    identity_pool: vec![cert.pem()],
                },
                cloud: None,
            };

            db.set_config(serde_json::to_string(&config).unwrap())
                .await
                .map_err(|err| error!("Failed to set Mattrax configuration in DB: {err}"))
                .unwrap();
        }

        let node_id = cuid2::create_id();

        let node = Node {
            version: env!("GIT_HASH").to_string(),
        };

        db.update_node(node_id.clone(), serde_json::to_string(&node).unwrap())
            .await
            .map_err(|err| error!("Failed to initialise node in DB: {err}"))
            .unwrap();

        fs::create_dir_all(&data_dir).unwrap();
        let Ok(_) = LocalConfig {
            node_id: node_id.clone(),
            db_url: db_url.to_string(),
        }
        .save(data_dir.join("config.json"))
        .map_err(|err| error!("Failed to save local configuration: {err}")) else {
            process::exit(1);
        };

        info!(
            "Initialised node '{node_id}'. Run '{} serve' to start the server.",
            binary_name()
        );

        if path.exists() {
            info!("Found systemd, installing and enabling service...");

            // TODO: Check for `useradd` cause it's doesn't exist on all systems
            // process::Command::new("useradd")
            //     .arg("mattrax")
            //     .arg("-s")
            //     .arg("/sbin/nologin")
            //     .arg("-M")
            //     .status()
            //     .unwrap();

            // TODO: non-root user
            // User=mattrax
            // Group=mattrax
            fs::write(
                "/etc/systemd/system/mattrax.service",
                format!(
                    r#"[Unit]
Description=Mattrax MDM
ConditionPathExists={}
After=network.target
StartLimitIntervalSec=60
    
[Service]
Type=simple
Restart=on-failure
RestartSec=10
ExecStart=mattrax serve
    
[Install]
WantedBy=multi-user.target"#,
                    data_dir.to_str().unwrap()
                ),
            )
            .unwrap();

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                fs::set_permissions(
                    "/etc/systemd/system/mattrax.service",
                    fs::Permissions::from_mode(0o664),
                )
                .unwrap();

                // fs::set_permissions(&data_dir, fs::Permissions::from_mode(0o664)).unwrap();

                // let res = nix::unistd::User::from_name("mattrax").unwrap().unwrap();
                // chownr::chownr(&data_dir, Some(res.uid), Some(res.gid)).unwrap();
            }

            process::Command::new("systemctl")
                .arg("daemon-reload")
                .status()
                .unwrap();

            process::Command::new("systemctl")
                .arg("enable")
                .arg("--now")
                .arg("mattrax.service")
                .status()
                .unwrap();
        }
    }
}
