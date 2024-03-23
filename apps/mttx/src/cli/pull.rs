use std::{fs, path::PathBuf};

use mattrax_policy::Policy;
use reqwest::{Client, Url};
use serde_json::Value;
use tracing::info;

#[derive(clap::Args)]
#[command(about = "Pull a policy from Mattrax to a local file")]
pub struct Command {
    #[arg(help = "The ID of the policy to pull")]
    policy_id: String,

    #[arg(help = "The file to write the policy to")]
    path: PathBuf,

    #[arg(long, short, action, help = "Overwrite the file if it already exists")]
    force: bool,
}

impl Command {
    pub async fn run(&self, base_url: Url, client: Client) -> Result<(), String> {
        if !self.force && self.path.exists() {
            return Err(format!("File already exists at {:?}", self.path));
        }

        let url = base_url
            .join(&format!(
                "/api/cli/policy/{}",
                urlencoding::encode(&self.policy_id)
            ))
            .map_err(|err| format!("Error constructing url to Mattrax API: {err}"))?;

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|err| format!("Error doing HTTP request to Mattrax API: {err}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Error fetching policy from Mattrax: {:?}",
                response.status()
            ));
        }

        // TODO: use a proper struct for the return type
        let body = response
            .json::<serde_json::Value>()
            .await
            .map_err(|err| format!("Error decoding response from Mattrax API: {err}"))?;

        let policy = Policy {
            id: self.policy_id.clone(),
            name: body
                .as_object()
                .unwrap()
                .get("name")
                .unwrap()
                .as_str()
                .unwrap()
                .to_string(),
            description: None, // TODO: From the backend
            configurations: serde_json::from_value(Value::Array(
                body.as_object()
                    .unwrap()
                    .get("data")
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .clone(),
            ))
            .unwrap(),
        };

        let yaml = serde_yaml::to_string(&policy)
            .map_err(|err| format!("Error serializing policy to YAML: {err}"))?;

        let yaml = format!(
            "# yaml-language-server: $schema={}schema/policy.json\n{yaml}",
            base_url.to_string()
        );

        fs::write(&self.path, yaml)
            .map_err(|err| format!("Error writing policy to file: {err}"))?;

        info!("Successfully pulled '{}' from Mattrax!", policy.name);

        Ok(())
    }
}
