use tracing::info;

#[derive(clap::Args)]
#[command(about = "Push a policy file to Mattrax")]
pub struct Command {}

impl Command {
    pub fn run(&self) {
        info!("Hello World");

        // TODO: Push the policy up into Mattrax.
    }
}
