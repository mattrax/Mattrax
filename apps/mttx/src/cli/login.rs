use std::time::Duration;

use reqwest::{Client, Url};
use tracing::{debug, info};

#[derive(clap::Args)]
#[command(about = "Authenticate with the Mattrax API")]
pub struct Command {}

#[derive(serde::Deserialize)]
pub struct CreatedAuthSession {
    url: String,
    jwt: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionVerification {
    // code: String,
    api_key: Option<String>,
    email: Option<String>,
}

impl Command {
    pub async fn run(&self, base_url: Url, client: Client) -> Result<(), String> {
        let url = base_url
            .join("/api/cli/auth")
            .map_err(|err| format!("session-create/url: {err}"))?;

        let auth_session = client
            .post(url)
            .send()
            .await
            .map_err(|err| format!("session-create/post: {err}"))?
            .json::<CreatedAuthSession>()
            .await
            .map_err(|err| format!("session-create/json: {err}"))?;

        info!("Opening {}", &auth_session.url);

        open::that(auth_session.url).map_err(|err| format!("session-verify/open: {err}"))?;

        let (api_key, email) = loop {
            tokio::time::sleep(Duration::from_secs(3)).await;

            let url = base_url
                .join(&format!("/api/cli/auth/{}", auth_session.jwt))
                .map_err(|err| format!("session-verify/url: {err}"))?;

            let verification = client
                .post(url)
                .send()
                .await
                .map_err(|err| format!("session-verify/post: {err}"))?
                .json::<AuthSessionVerification>()
                .await
                .map_err(|err| format!("session-verify/json: {err}"))?;

            if let Some(api_key) = verification.api_key {
                break (api_key, verification.email);
            }
        };

        if let Some(email) = email {
            info!("Logged in as {email}");
        } else {
            info!("Logged in succssfully");
        }

        debug!("API Key: {api_key}");

        Ok(())
    }
}
