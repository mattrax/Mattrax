use std::{fs, path::PathBuf};

use mattrax_policy::Policy;
use reqwest::{Client, Url};
use serde_json::json;
use tracing::info;

#[derive(clap::Args)]
#[command(about = "Push a policy file to Mattrax")]
pub struct Command {
    #[arg(help = "The file to write the policy to")]
    path: PathBuf,
}

impl Command {
    pub async fn run(&self, base_url: Url, client: Client) -> Result<(), String> {
        if !self.path.exists() {
            return Err(format!("Policy file does not exist {:?}", self.path));
        }

        let yaml = fs::read_to_string(&self.path)
            .map_err(|err| format!("Error reading policy file: {err}"))?;

        let policy = serde_yaml::from_str::<Policy>(&yaml)
            .map_err(|err| format!("Error parsing policy file: {err}"))?;

        let url = base_url
            .join(&format!(
                "/api/cli/policy/{}",
                urlencoding::encode(&policy.id)
            ))
            .map_err(|err| format!("Error constructing url to Mattrax API: {err}"))?;

        let response = client
            .post(url)
            .json(&json!({
                "name": policy.name,
                // TODO: properly hook this up
                "data": policy.configurations,
            }))
            .send()
            .await
            .map_err(|err| format!("Error doing HTTP request to Mattrax API: {err}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Error pushing policy to Mattrax: {:?}",
                response.status()
            ));
        }

        info!("Successfully push '{}' to Mattrax!", policy.name);

        Ok(())
    }
}
