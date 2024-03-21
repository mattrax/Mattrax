use tracing::info;

#[derive(clap::Args)]
#[command(about = "Validate a policy file is valid offline")]
pub struct Command {}

impl Command {
    pub fn run(&self) {
        info!("Hello World");

        // TODO: Validate the policy file against the schema.
    }
}
