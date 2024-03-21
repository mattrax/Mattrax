use std::path::PathBuf;

use tracing::{error, info};

#[derive(clap::Args)]
#[command(about = "Validate a policy file is valid offline")]
pub struct Command {
    #[arg(help = "The file to write the policy to")]
    path: PathBuf,
}

impl Command {
    pub fn run(&self) {
        if !self.path.exists() {
            error!("Config file was not found at {:?}", self.path);
            return;
        }

        let Ok(config_raw) = std::fs::read_to_string(&self.path)
            .map_err(|err| error!("Failed to read config file: {err}"))
        else {
            return;
        };

        let Ok(file) = serde_yaml::from_str::<serde_yaml::Value>(&config_raw)
            .map_err(|err| error!("Failed to parse config file: {err}"))
        else {
            return;
        };

        // TODO: Validate the policy file against the schema (can Serde do this for us?)
        info!("{file:#?}");

        // TODO: Check for invalid values
    }
}
