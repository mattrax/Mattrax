use std::path::PathBuf;

use tracing::info;

#[derive(clap::Args)]
#[command(about = "Validate a policy file is valid offline")]
pub struct Command {
    #[arg(help = "The file to write the policy to")]
    path: PathBuf,
}

impl Command {
    pub fn run(&self) -> Result<(), String> {
        if !self.path.exists() {
            return Err(format!("Config file was not found at {:?}", self.path));
        }

        let config_raw = std::fs::read_to_string(&self.path)
            .map_err(|err| format!("Failed to read config file: {err}"))?;

        let file = serde_yaml::from_str::<serde_yaml::Value>(&config_raw)
            .map_err(|err| format!("Failed to parse config file: {err}"))?;

        // TODO: Validate the policy file against the schema (can Serde do this for us?)
        info!("{file:#?}");

        // TODO: Check for invalid values

        Ok(())
    }
}
