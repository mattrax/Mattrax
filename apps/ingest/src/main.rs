use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use ms_ddf::{AllowedValueGroupedNodes, DFFormatVariant, MgmtTree, Node};
use serde::Serialize;
use specta::{ts::ExportConfig, NamedType, Type};

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
struct WindowsDDFPolicy {
    name: String,
    description: Option<String>,
    #[serde(flatten)]
    format: Format,
}

#[derive(Serialize, Debug, Type)]
#[serde(tag = "format", rename_all = "camelCase")]
enum Format {
    #[serde(rename_all = "camelCase")]
    Int {
        default_value: i32,
        #[specta(optional)]
        allowed_values: Option<IntAllowedValues>,
    },
    Unknown,
}

impl Format {
    fn parse(node: &Node) -> Self {
        if matches!(*node.properties.df_format, DFFormatVariant::Int) {
            return Self::Int {
                default_value: 0,
                allowed_values: IntAllowedValues::parse(node),
            };
        }

        Self::Unknown
    }
}

#[derive(Serialize, Debug, Type)]
#[serde(tag = "valueType", rename_all = "camelCase")]
enum IntAllowedValues {
    Range {
        min: i32,
        max: i32,
    },
    Enum {
        #[serde(rename = "enum")]
        r#enum: BTreeMap<String, EnumContent>,
    },
}

impl IntAllowedValues {
    fn parse(node: &Node) -> Option<Self> {
        let Some(allowed_values) = &node.properties.allowed_values else {
            return None;
        };

        Some(match allowed_values.value_type {
            ms_ddf::ValueType::Range => {
                let AllowedValueGroupedNodes::Value(value) = &allowed_values.values else {
                    return None;
                };

                let Some((min, max)) = value.value[1..value.value.len() - 2].split_once("-") else {
                    return None;
                };

                Self::Range {
                    min: min.parse().ok()?,
                    max: max.parse().ok()?,
                }
            }
            ms_ddf::ValueType::ENUM => {
                let AllowedValueGroupedNodes::Enum(variants) = &allowed_values.values else {
                    return None;
                };

                Self::Enum {
                    r#enum: variants
                        .iter()
                        .map(|variant| {
                            (
                                variant.value.clone(),
                                EnumContent {
                                    description: variant.value_description.clone(),
                                },
                            )
                        })
                        .collect(),
                }
            }
            _ => {
                return None;
            }
        })
    }
}

#[derive(Serialize, Debug, Type)]
struct EnumContent {
    description: Option<String>,
}

type WindowsDFFPolicyGroup = BTreeMap<PathBuf, WindowsDDFPolicy>;

fn handle_node(node: &Node, path: &PathBuf) -> WindowsDFFPolicyGroup {
    let mut collection = WindowsDFFPolicyGroup::default();

    let path = node
        .path
        .as_ref()
        .map(|new_path| path.join(new_path))
        .unwrap_or_else(|| path.clone())
        .join(&node.node_name);

    if !node.children.is_empty() {
        for child in &node.children {
            collection.extend(handle_node(child, &path));
        }
    }

    let access_type = &node.properties.access_type;

    if access_type.len() == 1 && (access_type.get.is_some() || access_type.exec.is_some()) {
        return collection;
    }

    collection.insert(
        path,
        WindowsDDFPolicy {
            name: node.node_name.clone(),
            description: node.properties.description.clone(),
            format: Format::parse(&node),
        },
    );

    collection
}

fn handle_mgmt_tree(tree: MgmtTree) -> WindowsDFFPolicyGroup {
    let mut policies = WindowsDFFPolicyGroup::new();

    for node in tree.nodes {
        policies.extend(handle_node(&node, &PathBuf::new()))
    }

    policies
}

#[derive(Type, Default, Serialize)]
struct WindowsDFFPolicyCollection(WindowsDFFPolicyGroup);

fn main() {
    let manifests = profile_manifests::parse_from_dir(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("./manifests"),
    )
    .unwrap();

    // TODO: Hook this up to the rest of the code
    // println!("{:#?}", manifests);

    let files = fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("./ddf")).unwrap();

    let mut policy_collection = WindowsDFFPolicyCollection::default();

    for file in files {
        let file = file.unwrap();
        if !file.file_name().to_string_lossy().ends_with(".xml") {
            continue;
        }
        let contents = fs::read(file.path()).unwrap();

        let root: MgmtTree = easy_xml::de::from_bytes(contents.as_slice())
            .expect(&format!("Failed to parse {:?}", file.path()));

        policy_collection.0.extend(handle_mgmt_tree(root));
    }

    fs::write(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("generated/dff.json"),
        serde_json::to_string_pretty(&policy_collection).unwrap(),
    )
    .unwrap();

    let mut types = String::new();
    let mut type_map = Default::default();

    specta::ts::export_named_datatype(
        &ExportConfig::default(),
        &WindowsDFFPolicyCollection::definition_named_data_type(&mut type_map),
        &mut type_map,
    )
    .unwrap();

    type_map.iter().for_each(|(_, ty)| {
        types.push_str(
            &specta::ts::export_named_datatype(&Default::default(), ty, &mut type_map.clone())
                .unwrap(),
        );
        types.push('\n');
    });

    fs::write(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("generated/dff.ts"),
        types,
    )
    .unwrap();
}
