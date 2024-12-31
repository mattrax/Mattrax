use std::net::SocketAddr;

use clap::Parser;
use tokio::net::TcpListener;
use tracing::{error, info, level_filters::LevelFilter};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[derive(Parser)]
#[command(name = env!("CARGO_PKG_NAME"))]
#[command(bin_name = env!("CARGO_PKG_NAME"))]
#[command(version = mx_core::VERSION)]
#[command(about = env!("CARGO_PKG_DESCRIPTION"))]
pub struct Arguments {
    #[arg(
        short,
        long,
        help = "The address of your MySQL database. Eg. mysql://user:password@localhost:3306/mattrax"
    )]
    pub database_url: String,

    #[arg(short, long, default_value = "0.0.0.0:9000")]
    pub listen_addr: SocketAddr,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(
            EnvFilter::builder()
                .with_default_directive(
                    if cfg!(debug_assertions) {
                        LevelFilter::DEBUG
                    } else {
                        LevelFilter::INFO
                    }
                    .into(),
                )
                .from_env()
                .unwrap(),
        )
        .init();
    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));

    let command = Arguments::parse();
    println!("{:?}", command.database_url);

    if let Ok(listener) = TcpListener::bind(command.listen_addr).await.map_err(|err| {
        error!(
            "Failed to bind to listen address {:?} with error: {err:?}",
            command.listen_addr
        )
    }) {
        info!(
            "Listening at: {:?}",
            listener.local_addr().unwrap_or(command.listen_addr)
        );
        axum::serve(listener, mx_api::mount())
            .await
            // I checked and I think this is actually unreachable.
            .expect("Error with Axum server");
    }
}
