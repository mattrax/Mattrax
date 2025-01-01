use std::net::SocketAddr;

use clap::Parser;
use tracing::level_filters::LevelFilter;
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
        env,
        help = "The address of your MySQL database. Eg. mysql://user:password@localhost:3306/mattrax"
    )]
    pub database_url: String,

    #[arg(short, long, env, default_value = "0.0.0.0:9000")]
    pub listen_addr: SocketAddr,
}

pub fn setup() -> Arguments {
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

    Arguments::parse()
}
