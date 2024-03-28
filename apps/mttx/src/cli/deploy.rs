use std::{error::Error, fs, path::PathBuf};

use mattrax_policy::Policy;
use reqwest::{Client, Url};
use serde_json::json;
use tracing::info;

#[derive(clap::Args)]
#[command(about = "Deploy a policy to Mattrax")]
pub struct Command {
    #[arg(help = "The path to the policy file")]
    path: PathBuf,

    #[arg(
        short,
        long,
        help = "Update policy in Mattrax without creating a new version. You will be required to click deploy manually."
    )]
    no_deploy: bool,

    #[arg(short, long, help = "The message to include with the policy version")]
    message: Option<String>,
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

        let comment = (!self.no_deploy).then(|| {
            self.message.clone().unwrap_or_else(|| {
                std::process::Command::new("git")
                    .args(["rev-parse", "--short", "HEAD"])
                    .output()
                    .ok()
                    .and_then(|output| {
                        std::str::from_utf8(&output.stdout)
                            .ok()
                            .map(|s| format!("Deployed commit {s} via Mattrax CLI!"))
                    })
                    .unwrap_or_else(|| "Deployed from Mattrax CLI!".to_string())
            })
        });

        let response = client
            .post(url)
            .json(&json!({
                "name": policy.name,
                "data": policy.configurations,
                "comment": comment,
            }))
            .send()
            .await
            .map_err(|err| format!("Error doing HTTP request to Mattrax API: {err}"))?;

        if response.status() == 404 {
            return Err(format!("Policy with id '{}' not found", policy.id));
        }

        if !response.status().is_success() {
            return Err(format!(
                "Error pushing policy to Mattrax: {:?}",
                response.status()
            ));
        }

        let (status, version_id): (String, Option<String>) = response.json().await.unwrap();

        // TODO: Work this out with auth stuff
        let org_slug = "oscar-w4cw";
        let tenant_slug = "acme-school-inc-pa1r";

        // TODO: Can we make a nice alias for these URL's
        match (status.as_str(), version_id) {
            ("unchanged", None) => {
                info!("Policy '{}' is already up to date in Mattrax", policy.name);
            }
            ("deployed", Some(version_id)) => {
                info!("Successfully deployed policy '{}' to Mattrax!", policy.name);
                info!(
                    "Check it out at: {base_url}o/{org_slug}/t/{tenant_slug}/policies/{}/versions/{version_id}",
                    policy.id
                );
            }
            ("updated", None) => {
                info!("Successfully pushed '{}' to Mattrax!", policy.name);
                info!(
                    "To deploy go to: {base_url}o/{org_slug}/t/{tenant_slug}/policies/{}/versions",
                    policy.id
                );
            }
            _ => unreachable!(),
        }

        Ok(())
    }
}
