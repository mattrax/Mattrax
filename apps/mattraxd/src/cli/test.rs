use tracing::info;

#[derive(clap::Args)]
#[command(about = "Test the agent binary")]
pub struct Command {}

impl Command {
    pub fn run(&self) {
        info!("Hello World");
    }
}
