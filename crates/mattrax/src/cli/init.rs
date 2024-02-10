use std::{fs, path::PathBuf};

use tracing::warn;

use crate::config;

#[derive(clap::Args)]
#[command(about = "Initialise a new Mattrax installation.")]
pub struct Command {}

impl Command {
    pub fn run(&self, data_dir: PathBuf) {
        let mut secret = [0u8; 32];
        getrandom::getrandom(&mut secret).unwrap();

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

        fs::create_dir_all(&data_dir).unwrap();
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
