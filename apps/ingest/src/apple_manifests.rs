use std::{collections::BTreeMap, fs, path::Path};

use apple_pfm::Preference;
use serde::Serialize;
use specta::{NamedType, Type};

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
struct AppleProfilePayload {
    title: String,
    description: String,
    properties: BTreeMap<String, Property>,
    #[serde(skip_serializing_if = "is_false")]
    supervised: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub enum PropertyType {
    Array(Vec<PropertyType>),
    Boolean,
    Date,
    Data,
    Dictionary(BTreeMap<String, Property>),
    Integer,
    Real,
    Float,
    #[serde(rename_all = "camelCase")]
    String {
        range_list: Vec<(String, String)>,
    },
    Url,
    Alias,
    UnionPolicy,
    // special case where dictionary has no entries
    Plist,
}

impl PropertyType {
    fn from_preference(preference: Preference) -> Self {
        match preference {
            Preference::Array { pfm_subkeys, .. } => PropertyType::Array(
                pfm_subkeys
                    .into_iter()
                    .map(PropertyType::from_preference)
                    .collect(),
            ),
            Preference::Boolean(_) => PropertyType::Boolean,
            Preference::Date(_) => PropertyType::Date,
            Preference::Data(_) => PropertyType::Data,
            Preference::Dictionary { pfm_subkeys, .. } => {
                let entries = pfm_subkeys
                    .into_iter()
                    .map(|preference| {
                        (
                            preference.pfm_name.clone().unwrap(),
                            Property::parse(preference),
                        )
                    })
                    .collect::<BTreeMap<_, _>>();

                if entries.is_empty() {
                    PropertyType::Plist
                } else {
                    PropertyType::Dictionary(entries)
                }
            }
            Preference::Integer(_) => PropertyType::Integer,
            Preference::Real(_) => PropertyType::Real,
            Preference::Float(_) => PropertyType::Float,
            Preference::String {
                pfm_range_list,
                pfm_range_list_titles,
                ..
            } => PropertyType::String {
                range_list: pfm_range_list
                    .into_iter()
                    .zip(pfm_range_list_titles)
                    .collect(),
            },
            Preference::Url(_) => PropertyType::Url,
            Preference::Alias(_) => PropertyType::Alias,
            Preference::UnionPolicy(_) => PropertyType::UnionPolicy,
        }
    }
}

#[derive(Serialize, Debug, Type)]
pub struct Property {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    r#type: PropertyType,
    #[serde(skip_serializing_if = "is_false")]
    supervised: bool,
}

impl Property {
    fn parse(preference: apple_pfm::Preference) -> Property {
        Property {
            title: preference
                .pfm_title
                .as_ref()
                .or(preference.pfm_name.as_ref())
                .cloned(),
            description: preference.pfm_description.clone(),
            supervised: preference.pfm_supervised.unwrap_or_default(),
            r#type: PropertyType::from_preference(preference),
        }
    }
}

type AppleProfilePayloadGroup = BTreeMap<String, AppleProfilePayload>;

#[derive(Type, Default, Serialize)]
struct AppleProfilePayloadCollection(AppleProfilePayloadGroup);

pub static COMMON_PAYLOAD_KEYS: [&str; 7] = [
    "PayloadDescription",
    "PayloadDisplayName",
    "PayloadIdentifier",
    "PayloadType",
    "PayloadUUID",
    "PayloadVersion",
    "PayloadOrganization",
];

pub fn generate_bindings() {
    let plist_files = glob::glob(&format!(
        "{}/manifests/**/*.plist",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();

    // let mut json = vec![];

    // for file in plist_files {
    //     json.push(
    //         serde_json::to_value(
    //             plist::from_file::<_, plist::Value>(file.unwrap().as_path()).unwrap(),
    //         )
    //         .unwrap(),
    //     )
    // }

    // fs::write(
    //     Path::new(env!("CARGO_MANIFEST_DIR")).join("json/apple-manifests.json"),
    //     serde_json::to_string_pretty(&serde_json::to_value(json).unwrap()).unwrap(),
    // )
    // .unwrap();

    let mut payloads = AppleProfilePayloadCollection::default();

    for file in plist_files {
        let manifest = apple_pfm::Manifest::from_file(file.unwrap().as_path());

        let properties = manifest
            .pfm_subkeys
            .into_iter()
            .filter(|subkey| {
                !COMMON_PAYLOAD_KEYS.contains(&subkey.pfm_name.as_deref().unwrap_or(""))
            })
            .map(|subkey| (subkey.pfm_name.clone().unwrap(), Property::parse(subkey)))
            .collect();

        let profile = AppleProfilePayload {
            title: manifest.pfm_title,
            description: manifest.pfm_description,
            properties,
            supervised: manifest.pfm_supervised.unwrap_or_default(),
        };

        payloads.0.insert(manifest.pfm_domain, profile);
    }

    payloads.0.remove("Configuration");

    let mut types = String::new();
    let type_map = &mut Default::default();

    fs::write(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/configuration-schemas/src/apple/payloads.json"),
        serde_json::to_string_pretty(&payloads).unwrap(),
    )
    .unwrap();

    specta::ts::export_named_datatype(
        &specta::ts::ExportConfig::default(),
        &AppleProfilePayloadCollection::definition_named_data_type(type_map),
        type_map,
    )
    .unwrap();

    type_map.iter().for_each(|(_, ty)| {
        types.push_str(
            &specta::ts::export_named_datatype(&Default::default(), ty, type_map).unwrap(),
        );
        types.push('\n');
    });

    fs::write(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/configuration-schemas/src/apple/payloads.ts"),
        types,
    )
    .unwrap();
}
