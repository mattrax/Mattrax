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
struct WindowsCSP {
    name: String,
    policies: BTreeMap<PathBuf, WindowsDDFPolicy>,
}

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
struct WindowsDDFPolicy {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(flatten)]
    format: Format,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    nodes: WindowsDFFPolicyGroup,
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
    Bool,
    String,
    Node,
    Null,
    Base64,
    Time,
    Float,
    Xml,
    Bin,
}

impl Format {
    fn parse(node: &Node) -> Self {
        match &*node.properties.df_format {
            DFFormatVariant::Bool => Self::Bool,
            DFFormatVariant::String => Self::String,
            DFFormatVariant::Node => Self::Node,
            DFFormatVariant::Null => Self::Null,
            DFFormatVariant::Base64 => Self::Base64,
            DFFormatVariant::Time => Self::Time,
            DFFormatVariant::Float => Self::Float,
            DFFormatVariant::Xml => Self::Xml,
            DFFormatVariant::Bin => Self::Bin,
            DFFormatVariant::Int => Self::Int {
                default_value: 0,
                allowed_values: IntAllowedValues::parse(node),
            },
            format => todo!("{}", format.to_string()),
        }
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

                let Some((min, max)) = value.value[1..value.value.len() - 2].split_once('-') else {
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

    let mut path = node
        .path
        .as_ref()
        .map(|new_path| path.join(new_path))
        .unwrap_or_else(|| path.clone());

    let mut nodes = WindowsDFFPolicyGroup::new();

    if let (Some(title), "") = (&node.properties.df_title, node.node_name.as_str()) {
        dbg!(&title);
        path = path.join(format!("{{{title}}}"));

        for child in &node.children {
            nodes.extend(handle_node(child, &PathBuf::new()));
        }
    } else {
        path = path.join(&node.node_name);

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
            title: node.properties.df_title.clone(),
            description: node.properties.description.clone(),
            format: Format::parse(node),
            nodes,
        },
    );

    collection
}

fn handle_mgmt_tree(tree: MgmtTree) -> Vec<(PathBuf, WindowsCSP)> {
    tree.nodes
        .into_iter()
        .map(|node| {
            let mut csp = WindowsCSP {
                name: node.node_name.clone(),
                policies: Default::default(),
            };

            for node in node.children {
                csp.policies.extend(handle_node(&node, &PathBuf::new()))
            }

            (PathBuf::from(node.path.unwrap()).join(node.node_name), csp)
        })
        .collect()
}

#[derive(Type, Default, Serialize)]
struct WindowsCSPCollection(BTreeMap<PathBuf, WindowsCSP>);

pub fn generate_bindings() {
    let files = fs::read_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("./ddf")).unwrap();

    let mut policy_collection = WindowsCSPCollection::default();

    for file in files {
        let file = file.unwrap();
        if !file.file_name().to_string_lossy().ends_with(".xml") {
            continue;
        }
        let contents = fs::read(file.path()).unwrap();

        let root: MgmtTree = easy_xml::de::from_bytes(contents.as_slice())
            .unwrap_or_else(|_| panic!("Failed to parse {:?}", file.path()));

        for (path, csp) in handle_mgmt_tree(root) {
            if !csp.policies.is_empty() {
                policy_collection.0.insert(path, csp);
            }
        }
    }

    fs::write(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/configuration-schemas/src/windows/ddf.json"),
        serde_json::to_string_pretty(&policy_collection).unwrap(),
    )
    .unwrap();

    let mut types = String::new();
    let mut type_map = Default::default();

    specta::ts::export_named_datatype(
        &ExportConfig::default(),
        &WindowsCSPCollection::definition_named_data_type(&mut type_map),
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
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/configuration-schemas/src/windows/ddf.ts"),
        types,
    )
    .unwrap();
}
