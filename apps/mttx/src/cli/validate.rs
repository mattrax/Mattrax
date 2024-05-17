use std::path::PathBuf;

// use tracing::info;

// use crate::load;

#[derive(clap::Args)]
#[command(about = "Validate a policy file is valid offline")]
pub struct Command {
    #[arg(help = "The file to write the policy to")]
    path: PathBuf,
}

impl Command {
    pub fn run(&self) -> Result<(), String> {
        todo!();
        // let _ = load::policy(&self.path)?;
        // info!("Policy file is valid");

        Ok(())
    }
}
