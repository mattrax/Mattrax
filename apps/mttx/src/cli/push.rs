use std::{fs, path::PathBuf};

use mattrax_policy::Policy;
use reqwest::{Client, Url};
use serde_json::json;
use tracing::{error, info};

#[derive(clap::Args)]
#[command(about = "Push a policy file to Mattrax")]
pub struct Command {
    #[arg(help = "The file to write the policy to")]
    path: PathBuf,
}

impl Command {
    pub async fn run(&self, base_url: Url, client: Client) {
        if !self.path.exists() {
            error!("Policy file does not exist {:?}", self.path);
            return;
        }

        let Ok(yaml) = fs::read_to_string(&self.path)
            .map_err(|err| error!("Error reading policy file: {err}"))
        else {
            return;
        };

        let Ok(policy) = serde_yaml::from_str::<Policy>(&yaml)
            .map_err(|err| error!("Error parsing policy file: {err}"))
        else {
            return;
        };

        let Ok(url) = base_url
            .join(&format!(
                "/api/cli/policy/{}",
                urlencoding::encode(&policy.id)
            ))
            .map_err(|err| error!("Error constructing url to Mattrax API: {err}"))
        else {
            return;
        };

        let Ok(response) = client
            .post(url)
            .json(&json!({
                "name": policy.name,
                // TODO: properly hook this up
                "data": policy.configurations,
            }))
            .send()
            .await
            .map_err(|err| error!("Error doing HTTP request to Mattrax API: {err}"))
        else {
            return;
        };
        if !response.status().is_success() {
            error!("Error pushing policy to Mattrax: {:?}", response.status());
            return;
        }

        info!("Successfully push '{}' to Mattrax!", policy.name);
    }
}
