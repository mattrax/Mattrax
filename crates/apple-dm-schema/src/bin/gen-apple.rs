//! This script generates the `apple-dm` crate using the Schema defined in this crate.

use std::{fs::DirEntry, path::{Path, PathBuf}};

fn main() -> Result<(), ()> {
    println!("TODO");

    // TODO: All the declarative stuff

    parse(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/ingest/device-management/mdm/checkin"), |_, _| {
        // TODO
    })?;

    parse(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/ingest/device-management/mdm/commands"), |_, _| {
        // TODO
    })?;

    parse(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/ingest/device-management/mdm/errors"), |_, _| {
        // TODO
    })?;

    parse(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/ingest/device-management/mdm/profiles"), |_, _| {
        // TODO
    })?;

    parse(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/ingest/device-management/other"), |_, _| {
        // TODO
    })?;

    Ok(())
}

pub fn parse(
    dir: impl AsRef<Path>,
    mut on_entry: impl FnMut(DirEntry, ()),
) -> Result<(), ()> {
    let entries = std::fs::read_dir(&dir)
        .map_err(|err| println!("Error parsing directory {:?}: {err:?}", dir.as_ref()))?;

    for entry in entries {
        let entry = entry
            .map_err(|err| println!("Error iterating directory {:?}: {err:?}", dir.as_ref()))?;

        // TODO: Remove this hack
        {
            let path = entry.path();
            let name = path.file_name().and_then(|v| v.to_str());
            if name == Some("com.apple.applicationaccess.new.yaml")
                || name == Some("com.apple.homescreenlayout.yaml")
            {
                continue;
            }
        }

        let file = std::fs::read_to_string(entry.path())
            .map_err(|err| println!("Error reading file {:?}: {err:?}", entry.path()))?;
        let schema: apple_dm_schema::Schema = serde_yaml::from_str(&file)
            .map_err(|err| println!("Error parsing file {:?}: {err:?}", entry.path()))?;

        println!("{:#?}", schema); // TODO: Handle the schema
    }

    Ok(())
}

pub fn export(schema: apple_dm_schema::Schema) {
    // TODO: Codegen from this
}
