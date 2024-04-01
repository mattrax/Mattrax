use std::path::PathBuf;

use clap::Parser;
use mx_utils::file_logger;

pub(crate) mod api;
mod cli;
pub(crate) mod config;

#[tokio::main]
async fn main() {
    let cli = cli::Cli::parse();

    let data_dir = cli.data_dir.clone().unwrap_or_else(|| {
        if cfg!(not(debug_assertions)) {
            PathBuf::from("/var/lib/mattrax")
        } else {
            PathBuf::from("./data")
        }
    });

    // Only some commands need file-based logging
    let _guard = if matches!(cli.command, cli::Commands::Serve { .. }) {
        Some(file_logger::setup(&data_dir, env!("CARGO_PKG_NAME")))
    } else {
        tracing_subscriber::fmt().init();
        None
    };

    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

    match cli.command {
        cli::Commands::Init(cmd) => cmd.run(data_dir),
        cli::Commands::Serve(cmd) => cmd.run(data_dir).await,
    }
}
