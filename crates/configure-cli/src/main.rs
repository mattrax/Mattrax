use std::process;

use graph_rs_sdk::{http::ResponseExt, identity::PublicClientApplication, Graph};
use serde::Deserialize;

static CLIENT_ID: &str = "246da6b9-2170-4c1c-9ea5-eba191f36f38"; // TODO: Create proper app outside the test tenant
static SCOPES: &[&str] = &[
    "User.Read",
    "Group.ReadWrite.All",
    "DeviceManagementConfiguration.ReadWrite.All",
    "DeviceManagementApps.ReadWrite.All",
];

#[tokio::main]
async fn main() {
    let mut client = authenticate().await;
    // let mut client = Graph::new("");

    let response = client
        .beta()
        .device_management()
        .device_configurations()
        .list_device_configurations()
        .send()
        .await
        .unwrap();
    if !response.status().is_success() {
        if let Ok(error) = response.into_graph_error_message().await {
            println!("{error:#?}");
            return; // TODO
        }
    } else {
        // let body: serde_json::Value = response.json().await.unwrap();
        // println!("{:#?}", body);

        // std::fs::write("./test.json", serde_json::to_string_pretty(&body).unwrap()).unwrap();

        let body: DeviceConfigurationResponse = response.json().await.unwrap();
        println!("{:#?}", body);
    }
}

#[derive(Deserialize)]
pub struct DeviceCodeResponse1 {
    pub user_code: String,
    pub verification_uri: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum Response {
    Error {
        error: String,
        error_description: String,
    },
    Ok {
        token_type: String,
        access_token: String,
        // TODO: Handle expiry
    },
}

#[derive(Deserialize)]
pub struct User {
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "userPrincipalName")]
    user_principal_name: String,
}

async fn authenticate() -> Graph {
    // TODO: Alternative login method that works for CI workflows
    // TODO: Cache the login between CLI runs

    let mut device_executor = PublicClientApplication::builder(CLIENT_ID)
        .with_device_code_executor()
        .with_scope(SCOPES)
        .with_tenant("common") // TODO: do the org only one
        .poll_async(None)
        .await
        .unwrap(); // TODO: Error handling

    let mut got_device_code = false;
    while let Some(response) = device_executor.recv().await {
        let body = response.into_body().unwrap(); // TODO: Error handling

        if !got_device_code {
            got_device_code = true;

            let body: DeviceCodeResponse1 = serde_json::from_value(body).unwrap(); // TODO: Error handling

            println!(
                "To authenticate with Intune please go to {} and enter {}",
                body.verification_uri, body.user_code
            );
        } else {
            let user: Response = serde_json::from_value(body).unwrap(); // TODO: Error handling

            match user {
                Response::Error { error, .. } if error == "authorization_pending" => {}
                Response::Error {
                    error,
                    error_description,
                } => {
                    println!("Error: {} - {}", error, error_description);
                    process::exit(1); // TODO: Return proper Rust error
                }
                Response::Ok {
                    token_type: _,
                    access_token,
                } => {
                    println!("{:?}", access_token); // TODO: Remove this

                    let client = Graph::new(access_token);

                    let response = client.me().get_user().send().await.unwrap();
                    if !response.status().is_success() {
                        if let Ok(error) = response.into_graph_error_message().await {
                            println!("Error getting user: {error:#?}");
                            process::exit(1); // TODO: Return proper Rust error
                        }
                    } else {
                        let user: User = response.json().await.unwrap();
                        println!("Successfully authenticated as '{}'!", user.display_name);
                    }

                    return client;
                }
            }
        }
    }

    println!("Error: no valid response");
    process::exit(1) // TODO: Return proper Rust error
}

#[derive(Debug, Deserialize)]
pub struct DeviceConfigurationResponse {
    pub value: Vec<DeviceConfiguration>,
}

#[derive(Debug, Deserialize)]
pub struct DeviceConfiguration {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    description: Option<String>,
    version: u64,
    #[serde(flatten)]
    payload: DeviceConfigurationPayload,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "@odata.type")]
pub enum DeviceConfigurationPayload {
    #[serde(rename = "#microsoft.graph.iosCustomConfiguration")]
    IOSCustom { payload: String },
    #[serde(rename = "#microsoft.graph.windows10CustomConfiguration")]
    Windows10Custom {
        #[serde(rename = "omaSettings")]
        oma_settings: Vec<Windows10CustomConfigurationOmaSetting>,
    },
    // TODO: Other ones
}

#[derive(Debug, Deserialize)]
#[serde(tag = "@odata.type")]
pub enum Windows10CustomConfigurationOmaSetting {
    #[serde(rename = "#microsoft.graph.omaSettingString")]
    String {
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "isEncrypted")]
        is_encrypted: bool,
        #[serde(rename = "omaUri")]
        oma_uri: String,
        #[serde(rename = "secretReferenceValueId")]
        secret_reference_value_id: String,
        value: String,
    },
    // TODO: Other ones
}
