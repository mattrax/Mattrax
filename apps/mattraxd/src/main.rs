use std::path::PathBuf;

use clap::Parser;
use mx_utils::file_logger;

mod cli;

fn main() {
    let cli = cli::Cli::parse();

    let data_dir = cli.data_dir.clone().unwrap_or_else(|| {
        if cfg!(not(debug_assertions)) {
            PathBuf::from("/var/lib/mattraxd") // TODO: proper default path for Windows
        } else {
            PathBuf::from("./data")
        }
    });

    // Only some commands need file-based logging
    // TODO: `matches!(cli.command, Commands::Serve { .. })`
    let _guard = if false {
        Some(file_logger::setup(&data_dir, env!("CARGO_PKG_NAME")))
    } else {
        tracing_subscriber::fmt().init();
        None
    };

    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

    match cli.command {
        cli::Commands::Test(cmd) => cmd.run(),
    }
}
