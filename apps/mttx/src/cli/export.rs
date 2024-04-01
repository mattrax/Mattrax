use std::{
    collections::HashMap,
    fs::{create_dir_all, write},
    path::PathBuf,
};

use ms_mdm::{Add, CmdId, Item, SyncBody, Target};
use mx_policy::{
    script::{Shell, Trigger},
    windows::{WindowsConfiguration, WindowsValue},
    Configuration,
};
use tracing::info;

use crate::load;

#[derive(clap::Args)]
#[command(about = "Render policy into local folder.")]
pub struct Command {
    #[arg(help = "The path to the policy file")]
    path: PathBuf,

    #[arg(help = "The folder to write the policy to")]
    out_dir: PathBuf,

    #[arg(short, long, help = "Delete the output directory if it already exists")]
    r#override: bool,
}

impl Command {
    pub async fn run(&self) -> Result<(), String> {
        if self.out_dir.exists() {
            if self.r#override {
                std::fs::remove_dir_all(&self.out_dir).unwrap();
            } else {
                return Err(format!(
                    "The output directory already exists {:?}",
                    self.out_dir
                ));
            }
        }

        let policy = load::policy(&self.path)?;

        create_dir_all(&self.out_dir).unwrap();

        let mut windows_entries = HashMap::new();
        for (config_name, configuration) in policy.configurations {
            match configuration {
                Configuration::Windows(windows) => match windows {
                    WindowsConfiguration::PolicyConfigBrowserHomePages { homepages } => todo!(),
                    WindowsConfiguration::PolicyEducationAllowGraphingCalculator {
                        allow_graphing_calculator,
                    } => todo!(),
                    WindowsConfiguration::Custom { custom } => {
                        for entry in custom {
                            windows_entries.insert(entry.oma_uri.clone(), entry);
                        }
                    }
                },
                Configuration::Apple(_) => todo!(),
                Configuration::Android(_) => todo!(),
                Configuration::Script(script) => {
                    let scripts_dir = self.out_dir.join("scripts");
                    if !scripts_dir.exists() {
                        create_dir_all(&scripts_dir).unwrap();
                    }

                    let ext = match script.shell {
                        Shell::Powershell => "ps1",
                        Shell::Bash => "sh",
                        Shell::Zsh => "zsh",
                    };

                    let mut result = String::new();
                    if !script.supported.is_empty() {
                        result.push_str(&format!(
                            "# This script is only supported on: [{}]",
                            script
                                .supported
                                .iter()
                                .map(|v| v.to_string())
                                .collect::<Vec<&str>>()
                                .join(", "),
                        ));
                    }

                    if script.trigger != Trigger::Once {
                        result.push_str(&format!(
                            "# This script is triggered on: {:?}",
                            script.trigger
                        ));
                    }

                    // TODO: Probs hoist the user's shebang to the top of the file

                    result.push('\n');
                    result.push('\n');
                    result.push_str(&script.run);

                    write(scripts_dir.join(format!("{config_name}.{ext}")), result).unwrap();
                }
            }
        }

        let mut syncml_body = SyncBody::default();
        for (oma_uri, entry) in windows_entries {
            // TODO: Add vs Replace vs etc
            syncml_body.children.push(
                Add {
                    cmd_id: CmdId::new("1").unwrap(), // TODO: Fleet don't have this
                    meta: None,
                    item: vec![Item {
                        source: None,
                        target: Some(Target::new(oma_uri)),
                        meta: None,
                        data: Some(match entry.value {
                            WindowsValue::String(value) => value,
                            _ => todo!(),
                        }),
                    }],
                }
                .into(),
            );
        }

        // TODO: Should we export all in one, or by each configuration.
        //  - All in one means the conflict resolution will be done
        //  - Separately means no conflict resolution but your stuff stays organised like scripts

        // TODO: Make the SyncML pretty printed
        // TODO: Remove `SyncBody` wrapper
        write(
            self.out_dir.join(format!("windows.xml")),
            easy_xml::se::to_string(&syncml_body).unwrap(),
        )
        .unwrap();

        info!("Successfully exported configuration to {:?}", self.out_dir);

        Ok(())
    }
}
