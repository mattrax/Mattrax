use reqwest::{Url};

#[derive(clap::Args)]
#[command(about = "Open Mattrax dashboard for the current tenant")]
pub struct Command {}

impl Command {
    pub async fn run(&self, _base_url: Url) -> Result<(), String> {
        // TODO: Open to the correct tenant for your local stuff
        todo!();

        Ok(())
    }
}
