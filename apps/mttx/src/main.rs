use clap::Parser;
use reqwest::{Client, Url};
use tracing::error;

mod cli;

#[tokio::main]
async fn main() {
    let cli = cli::Cli::parse();
    tracing_subscriber::fmt()
        .without_time()
        .with_target(false)
        .init();

    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

    let Ok(base_uri) =
        Url::parse(&cli.server).map_err(|e| error!("`--server` flag is not a valid url: {e}"))
    else {
        return;
    };

    let Ok(client) = Client::builder()
        .user_agent(format!(concat!(
            "Mattrax ",
            env!("CARGO_PKG_VERSION"),
            "/",
            env!("GIT_HASH")
        )))
        .build()
        .map_err(|e| error!("Error constructing HTTP client: {e}"))
    else {
        return;
    };

    match cli.command {
        cli::Commands::Validate(cmd) => cmd.run(),
        cli::Commands::Pull(cmd) => cmd.run(base_uri, client).await,
        cli::Commands::Push(cmd) => cmd.run(base_uri, client).await,
        cli::Commands::Login(cmd) => cmd.run(base_uri, client).await,
    }
}
