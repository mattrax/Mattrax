use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use ms_ddf::{AllowedValueGroupedNodes, DFFormatVariant, MgmtTree, Node, ScopeVariant};
use serde::Serialize;
use specta::{NamedType, Type};
use specta_typescript::Typescript;

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
struct WindowsCSP {
    name: String,
    nodes: BTreeMap<String, WindowsDDFNode>,
}

#[derive(Serialize, Debug, Type, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    User,
    Device,
}

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
struct WindowsDDFNode {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(flatten)]
    format: Format,
    scope: Scope,
    dynamic: Option<String>,
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
    Node {
        #[serde(skip_serializing_if = "WindowsDFFNodeGroup::is_empty")]
        nodes: WindowsDFFNodeGroup,
    },
    Null,
    Base64,
    Time,
    Float,
    Xml,
    Bin,
}

impl Format {
    fn parse(node: &Node, scope: Scope) -> Option<Self> {
        Some(match &*node.properties.df_format {
            DFFormatVariant::Bool => Self::Bool,
            DFFormatVariant::String => Self::String,
            DFFormatVariant::Node => {
                let mut nodes = WindowsDFFNodeGroup::new();

                if node.node_name.is_empty() {
                    for child in &node.children {
                        nodes.extend(handle_node(child, &String::new(), scope));
                    }
                }

                if nodes.is_empty() {
                    return None;
                }

                Self::Node { nodes }
            }
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
        })
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
        let allowed_values = node.properties.allowed_values.as_ref()?;

        Some(match allowed_values.value_type {
            ms_ddf::ValueType::Range => {
                let AllowedValueGroupedNodes::Value(value) = &allowed_values.values else {
                    return None;
                };

                let (min, max) = value.value[1..value.value.len() - 2].split_once('-')?;

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

type WindowsDFFNodeGroup = BTreeMap<String, WindowsDDFNode>;

fn handle_node(node: &Node, path: &str, scope: Scope) -> WindowsDFFNodeGroup {
    let mut collection = WindowsDFFNodeGroup::default();

    let access_type = &node.properties.access_type;

    let mut path = node
        .path
        .as_ref()
        .map(|new_path| {
            if path == "" {
                new_path.to_string()
            } else {
                format!("{path}/{new_path}")
            }
        })
        .unwrap_or_else(|| path.to_string());

    let mut dynamic = None;

    if let (Some(title), "") = (&node.properties.df_title, node.node_name.as_str()) {
        if path == "" || path == "/" {
            path = format!("{{{title}}}");
        } else {
            dynamic = Some(title.to_string());
        }
    } else {
        if path == "" || path == "/" {
            path = format!("/{}", &node.node_name);
        } else {
            path = format!("{path}/{}", &node.node_name);
        }

        for child in &node.children {
            collection.extend(handle_node(child, &path, scope));
        }
    }

    if access_type.len() == 1 && (access_type.get.is_some() || access_type.exec.is_some()) {
        return collection;
    }

    if let Some(format) = Format::parse(node, scope) {
        if matches!(format, Format::Node { .. }) && !node.node_name.is_empty() {
            return collection;
        }

        collection.insert(
            path,
            WindowsDDFNode {
                name: node.node_name.clone(),
                title: node.properties.df_title.clone(),
                description: node.properties.description.clone(),
                format,
                scope,
                dynamic,
            },
        );
    }

    collection
}

fn handle_mgmt_tree(tree: MgmtTree) -> Vec<(PathBuf, WindowsCSP)> {
    tree.nodes
        .into_iter()
        .map(|node| {
            let mut csp = WindowsCSP {
                name: node.node_name.clone(),
                nodes: Default::default(),
            };

            let path = node.path.unwrap();

            let scope = if path.starts_with("./User") {
                Scope::User
            } else {
                Scope::Device
            };

            for node in node.children {
                csp.nodes.extend(handle_node(&node, "/", scope))
            }

            (PathBuf::from(path).join(node.node_name), csp)
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
            if !csp.nodes.is_empty() {
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
    let type_map = &mut Default::default();

    specta_typescript::export_named_datatype(
        &Typescript::default(),
        &WindowsCSPCollection::definition_named_data_type(type_map),
        type_map,
    )
    .unwrap();

    type_map.iter().for_each(|(_, ty)| {
        types.push_str(
            &specta_typescript::export_named_datatype(&Default::default(), ty, type_map).unwrap(),
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
