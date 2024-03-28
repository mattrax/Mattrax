// TODO: hide this from main `--help`

#[derive(clap::Args)]
#[command(about = "Render policy into local folder.")]
pub struct Command {
    #[arg(help = "The path to the policy file")]
    path: PathBuf,

    #[arg(help = "The folder to write the policy to")]
    path: PathBuf,
}

impl Command {
    pub async fn run(&self, base_url: Url, client: Client) -> Result<(), String> {
        if self.path.exists() {
            return Err(format!(
                "The output directory already exists {:?}",
                self.path
            ));
        }

        todo!();

        Ok(())
    }
}
