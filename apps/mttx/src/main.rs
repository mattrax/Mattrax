use clap::Parser;

mod cli;

fn main() {
    let cli = cli::Cli::parse();
    tracing_subscriber::fmt().init();

    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

    match cli.command {
        cli::Commands::Validate(cmd) => cmd.run(),
        cli::Commands::Push(cmd) => cmd.run(),
    }
}
