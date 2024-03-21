use reqwest::{Client, Url};
use tracing::info;

#[derive(clap::Args)]
#[command(about = "Push a policy file to Mattrax")]
pub struct Command {}

impl Command {
    pub async fn run(&self, base_url: Url, client: Client) {
        info!("Hello World");

        // TODO: Push the policy up into Mattrax.
    }
}
