use reqwest::{Client, Url};

#[derive(clap::Args)]
#[command(about = "Authenticate with the Mattrax API")]
pub struct Command {}

impl Command {
    pub async fn run(&self, _base_url: Url, _client: Client) {
        todo!("login with Mattrax API")
    }
}
