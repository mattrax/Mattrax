use std::net::SocketAddr;

use clap::Parser;

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

    #[arg(short, long, env, default_value = "0.0.0.0:9000")]
    pub listen_addr: SocketAddr,
}

pub fn setup() -> Arguments {
    std::panic::set_hook(Box::new(move |panic| tracing::error!("{panic}")));
    Arguments::parse()
}
