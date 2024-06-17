use std::time::Duration;

use reqwest::{Client, StatusCode, Url};
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
    api_key: String,
    email: String,
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

        let AuthSessionVerification { api_key, email } = loop {
            tokio::time::sleep(Duration::from_secs(3)).await;

            let url = base_url
                .join(&format!("/api/cli/auth/{}", auth_session.jwt))
                .map_err(|err| format!("session-verify/url: {err}"))?;

            let response = client
                .post(url)
                .send()
                .await
                .map_err(|err| format!("session-verify/post: {err}"))?;

            match response.status() {
                StatusCode::OK => {
                    break response
                        .json::<AuthSessionVerification>()
                        .await
                        .map_err(|err| format!("session-verify/json: {err}"))?;
                }
                // The user still hasn't finished authentication on the frontend
                StatusCode::ACCEPTED => continue,
                status => {
                    return Err(format!(
                        "session-verify/status: {status} {:?}",
                        response.text().await
                    ));
                }
            }
        };

        info!("Logged in as {email}");
        debug!("API Key: {api_key}");

        // TODO: Store this to disk

        Ok(())
    }
}
