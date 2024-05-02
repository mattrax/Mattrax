// use std::{fs, path::PathBuf};

// use mx_policy::Policy;

// /// Load a policy from a file and run any preprocessor directives
// pub fn policy(path: &PathBuf) -> Result<Policy, String> {
//     if !path.exists() {
//         return Err(format!("Policy file does not exist {path:?}"));
//     }

//     let yaml =
//         fs::read_to_string(&path).map_err(|err| format!("Error reading policy file: {err}"))?;

//     // TODO: Yaml preprocessor for `!File` & `!Env`

//     let policy = serde_yaml::from_str::<Policy>(&yaml)
//         .map_err(|err| format!("Error parsing policy file: {err}"))?;

//     Ok(policy)
// }
