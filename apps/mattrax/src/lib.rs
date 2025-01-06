use std::net::SocketAddr;

use clap::Parser;
use tracing::error;

#[derive(Parser)]
#[command(name = env!("CARGO_PKG_NAME"))]
#[command(bin_name = env!("CARGO_PKG_NAME"))]
#[command(version = mx_api::VERSION)]
#[command(about = env!("CARGO_PKG_DESCRIPTION"))]
pub struct Arguments {
    #[arg(
        short,
        long,
        env,
        help = "The address of your MySQL database. Eg. mysql://user:password@localhost:3306/mattrax"
    )]
    pub database_url: String,

    #[arg(
        short,
        long,
        env,
        help = "A secret for encrypting database data, authentication tokens and more. You can generate it with `openssl rand -hex 32`"
    )]
    pub secret: String,

    #[arg(short, long, env, default_value = "0.0.0.0:9000")]
    pub listen_addr: SocketAddr,
}

pub fn setup() -> Arguments {
    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));
    let args = Arguments::parse();
    if args.secret.len() < 32 {
        error!("The secret must be larger than 32 characters. We recommend 64 characters which can be generated with `openssl rand -hex 32`");
        std::process::exit(1);
    }
    args
}
