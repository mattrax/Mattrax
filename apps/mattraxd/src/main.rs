//! `mattraxd` command surface.
//!
//! Public commands are `version` and `update`. The runtime commands are
//! internal: they live under the hidden `agent` subcommand so the top level
//! stays free for the admin/debug commands planned for enrolled devices.
//! Bare `mattraxd` still runs the daemon, which keeps the existing launchd
//! invocation working.

use clap::{Args, Parser, Subcommand};
use mattraxd::agent::Agent;
use mattraxd::logging::Logger;
use mattraxd::update::{self, Channel, UpdateOptions};
use std::process::ExitCode;

#[derive(Parser)]
#[command(
  name = "mattraxd",
  version = mattraxd::VERSION,
  about = "The Mattrax on-device daemon",
  long_about = None,
  disable_help_subcommand = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Print the agent version.
    Version,

    /// Update the agent from a signed release channel.
    Update(UpdateArgs),

    /// Internal runtime commands (hidden; not an operator interface).
    #[command(name = "agent", hide = true)]
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },

    /// Compatibility alias for the 1.0 launchd plist, which invoked "run".
    #[command(name = "run", hide = true)]
    Run,

    /// Compatibility alias for the 1.0 operator docs.
    #[command(name = "once", hide = true)]
    Once,
}

#[derive(Args)]
struct UpdateArgs {
    /// Release channel to follow.
    #[arg(long, value_enum, default_value_t = Channel::Stable)]
    channel: Channel,

    /// Report whether an update is available without installing it.
    #[arg(long)]
    check: bool,

    /// Restart the launchd service after replacing the binary.
    #[arg(long)]
    restart: bool,

    /// Allow installing an older version.
    #[arg(long)]
    force: bool,

    /// Override the channel manifest URL (self-hosted mirrors).
    #[arg(long)]
    manifest_url: Option<String>,
}

#[derive(Subcommand)]
enum AgentCommand {
    /// Run the daemon loop (the launchd invocation).
    Run,

    /// Evaluate every trigger once and exit.
    Once,
}

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            let informational = matches!(
                error.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            );
            let _ = error.print();

            // Swift exited 64 for a bad command line. Keep that contract for
            // scripts that distinguish usage errors from runtime failures.
            return if informational {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(64)
            };
        }
    };

    match cli.command.unwrap_or(Command::Agent {
        command: AgentCommand::Run,
    }) {
        Command::Version => {
            println!("mattraxd {}", mattraxd::VERSION);
            ExitCode::SUCCESS
        }
        Command::Agent { command } => match command {
            AgentCommand::Once => {
                Agent::system().run_once();
                ExitCode::SUCCESS
            }
            AgentCommand::Run => Agent::system().run_forever(),
        },
        // A device updated from 1.0 keeps its old plist ("mattraxd run") until
        // the next pkg install; both aliases must keep the daemon alive.
        Command::Run => Agent::system().run_forever(),
        Command::Once => {
            Agent::system().run_once();
            ExitCode::SUCCESS
        }
        Command::Update(arguments) => {
            let logger = Logger::system();
            let current_exe = match std::env::current_exe() {
                Ok(path) => path,
                Err(error) => {
                    eprintln!("mattraxd: cannot locate the running binary: {error}");
                    return ExitCode::FAILURE;
                }
            };
            let options = UpdateOptions {
                channel: arguments.channel,
                check: arguments.check,
                restart: arguments.restart,
                force: arguments.force,
                manifest_url: arguments.manifest_url,
            };

            match update::run(&options, &logger, &current_exe) {
                Ok(outcome) => {
                    match outcome {
                        update::Outcome::UpToDate { version } => {
                            println!("mattraxd {version} is up to date");
                        }
                        update::Outcome::Available {
                            version,
                            platform,
                            url,
                        } => {
                            println!("mattraxd {version} is available for {platform}");
                            println!("{url}");
                        }
                        update::Outcome::Updated {
                            from,
                            to,
                            restarted,
                        } => {
                            println!("updated mattraxd from {from} to {to}");
                            println!(
                                "{}",
                                if restarted {
                                    "the service was restarted"
                                } else {
                                    "restart the service to run the new binary"
                                }
                            );
                        }
                    }

                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("mattraxd: update failed: {error}");
                    ExitCode::FAILURE
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_the_hidden_agent_surface() {
        let cli = Cli::try_parse_from(["mattraxd", "agent", "once"]).expect("parses");

        assert!(matches!(
            cli.command,
            Some(Command::Agent {
                command: AgentCommand::Once
            })
        ));
    }

    #[test]
    fn legacy_run_and_once_aliases_still_parse() {
        assert!(matches!(
            Cli::try_parse_from(["mattraxd", "run"])
                .expect("parses")
                .command,
            Some(Command::Run)
        ));
        assert!(matches!(
            Cli::try_parse_from(["mattraxd", "once"])
                .expect("parses")
                .command,
            Some(Command::Once)
        ));
    }

    #[test]
    fn bare_invocation_means_run() {
        let cli = Cli::try_parse_from(["mattraxd"]).expect("parses");

        assert!(cli.command.is_none());
    }

    #[test]
    fn update_defaults_to_stable_and_parses_flags() {
        let cli = Cli::try_parse_from([
            "mattraxd",
            "update",
            "--channel",
            "latest",
            "--check",
            "--restart",
        ])
        .expect("parses");

        let Some(Command::Update(arguments)) = cli.command else {
            panic!("expected update");
        };

        assert_eq!(arguments.channel, Channel::Latest);
        assert!(arguments.check);
        assert!(arguments.restart);
        assert!(!arguments.force);
    }
}
