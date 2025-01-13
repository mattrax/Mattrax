//! An internal tool for automatically scaffolding types from external schemas.
//!
//! Must run before running this script:
//!  - git submodule update --init
//!
//! Run to update the downstream module:
//!  - git submodule update --remote

use std::path::PathBuf;

mod apple_schema;
mod mx_apple;

fn main() -> Result<(), ()> {
    println!("Starting ingest...");
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    println!("Generating `apple-dm-schema` crate...");
    mx_apple::parse_dm_schema(base.join("device-management/docs/schema.yaml"))?;

    // let schema = std::fs::read_to_string(base.join("schema.json")).unwrap();
    // let schema: schemars::schema::RootSchema = serde_json::from_str(&schema).unwrap();
    // println!("{:#?}", schema);

    // mx_apple::parse_dm_schema(base.join("debug.yaml"))?;

    return Ok(()); // TODO

    // println!("Generating `apple-dm` crate...");
    // mx_apple::generate_file(
    //     base.join("./device-management/mdm/checkin"),
    //     base.join("../../crates/mx-apple/src/checkin.rs"),
    // )?;
    // mx_apple::generate_file(
    //     base.join("./device-management/mdm/commands"),
    //     base.join("../../crates/mx-apple/src/commands.rs"),
    // )?;
    // mx_apple::generate_file(
    //     base.join("./device-management/mdm/errors"),
    //     base.join("../../crates/mx-apple/src/errors.rs"),
    // )?;
    // mx_apple::generate_file(
    //     base.join("./device-management/mdm/profiles"),
    //     base.join("../../crates/mx-apple/src/profiles.rs"),
    // )?;

    Ok(())
}
