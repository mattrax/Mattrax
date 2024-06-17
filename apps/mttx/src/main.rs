use clap::Parser;
use reqwest::{Client, Url};
use tracing::error;
use tracing_subscriber::EnvFilter;

mod cli;
mod load;

#[tokio::main]
async fn main() {
    let cli = cli::Cli::parse();
    tracing_subscriber::fmt()
        .without_time()
        .with_target(false)
        .with_env_filter(EnvFilter::from({
            if cfg!(debug_assertions) {
                "mttx=debug"
            } else {
                "mttx=info"
            }
        }))
        .init();

    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

    let Ok(base_uri) =
        Url::parse(&cli.server).map_err(|e| error!("`--server` flag is not a valid url: {e}"))
    else {
        return;
    };

    let Ok(client) = Client::builder()
        .user_agent(
            concat!("Mattrax ", env!("CARGO_PKG_VERSION"), "/", env!("GIT_HASH")).to_string(),
        )
        .build()
        .map_err(|e| error!("Error constructing HTTP client: {e}"))
    else {
        return;
    };

    let result = match cli.command {
        cli::Commands::Validate(cmd) => cmd.run(),
        cli::Commands::Pull(cmd) => cmd.run(base_uri, client).await,
        cli::Commands::Deploy(cmd) => cmd.run(base_uri, client).await,
        cli::Commands::Login(cmd) => cmd.run(base_uri, client).await,
        cli::Commands::Open(cmd) => cmd.run(base_uri).await,
        cli::Commands::Export(cmd) => cmd.run().await,
    };

    if let Err(e) = result {
        error!("{e}");
    }
}
