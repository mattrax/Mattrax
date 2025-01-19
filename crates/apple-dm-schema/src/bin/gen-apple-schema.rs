//! This script generates the `apple-dm-schema` crate.
//!
//! Must run before running this script:
//!  - git submodule update --init
//!
//! Run to update the downstream module:
//!  - git submodule update --remote

use std::path::PathBuf;

use specta::TypeCollection;

fn main() -> Result<(), ()> {
    println!("Generating `apple-dm-schema` crate...");

    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let schema = std::fs::read_to_string(base.join("../../vendor/device-management/docs/schema.yaml"))
        .map_err(|e| println!("Failed to read schema file: {:?}", e))?;

    // TODO: Solve the yaml recursion limit.
    let schema: schemars::schema::Schema = serde_yaml::from_str(&schema)
        .map_err(|e| println!("Failed to parse schema file: {:?}", e))?;

    let ty = specta_jsonschema::to_ast(&schema)
        .map_err(|e| println!("Failed to convert schema to Specta AST: {:?}", e))?;

    let types = TypeCollection::default();
    // TODO: Register `ty` into `types`.

    specta_rust::Rust::default()
        // TODO: Fix file path
        .export_to("todo.rs", &types)
        .map_err(|e| println!("Failed to export Specta AST to Rust: {:?}", e))?;

    Ok(())
}
