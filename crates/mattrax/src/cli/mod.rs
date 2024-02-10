use std::path::PathBuf;

use clap::{Parser, Subcommand};

mod init;
mod serve;

#[derive(Parser)]
#[command(name = env!("CARGO_PKG_NAME"))]
#[command(bin_name = env!("CARGO_PKG_NAME"))]
#[command(version = concat!(env!("CARGO_PKG_VERSION"), " - ", env!("GIT_HASH")))]
#[command(disable_version_flag = true)]
#[command(about = env!("CARGO_PKG_DESCRIPTION"))]
pub struct Cli {
    #[arg(short, long)]
    pub data_dir: Option<PathBuf>,

    // We wanna support `-v` and that's not a Clap default
    #[arg(short = 'v', short_alias = 'V', long, action = clap::builder::ArgAction::Version)]
    version: (),

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    Init(init::Command),
    Serve(serve::Command),
}
