//! This script generates the `apple-dm` crate using the Schema defined in this crate.
//!
//! Must run before running this script:
//!  - git submodule update --init
//!
//! Run to update the downstream module:
//!  - git submodule update --remote

use std::{fs::DirEntry, path::{Path, PathBuf}};
use apple_dm_schema::PayloadKeyType;
use inflector::Inflector;
use specta::{builder::{FieldBuilder, StructBuilder}, datatype::{DataType, PrimitiveType}, TypeCollection};
use specta_typescript::Typescript;

fn main() -> Result<(), ()> {
    println!("Generating `apple-dm` crate...");
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // TODO: All the declarative stuff

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/checkin"),
            |_, schema| export(&mut types, schema)
        )?;

        // TODO: Switch to Rust exporter
        Typescript::default().export_to("./checkin.ts", &types).unwrap();
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/commands"),
            |_, schema| export(&mut types, schema)
        )?;

        // TODO: Switch to Rust exporter
        Typescript::default().export_to("./commands.ts", &types).unwrap();
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/errors"),
            |_, schema| export(&mut types, schema)
        )?;

        // TODO: Switch to Rust exporter
        Typescript::default().export_to("./errors.ts", &types).unwrap();
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/profiles"),
            |_, schema| export(&mut types, schema)
        )?;

        // TODO: Switch to Rust exporter
        Typescript::default().export_to("./profiles.ts", &types).unwrap();
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/other"),
            |_, schema| export(&mut types, schema)
        )?;

        // TODO: Switch to Rust exporter
        Typescript::default().export_to("./other.ts", &types).unwrap();
    }

    println!("Done!");
    Ok(())
}

pub fn parse(
    dir: impl AsRef<Path>,
    mut on_entry: impl FnMut(DirEntry, apple_dm_schema::Schema),
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
        on_entry(entry, schema);
    }

    Ok(())
}

pub fn export(types: &mut TypeCollection, schema: apple_dm_schema::Schema) {
    let mut name = schema.title.to_class_case();

    // TODO: Don't do this?
    if name.starts_with("8021X") {
        name = format!("TODO{name}");
    }

    let mut s = StructBuilder::named(name.clone()); // TODO: Docs
    for key in schema.payloadkeys.into_iter().flatten() {
        let ty = match key.key_type {
            PayloadKeyType::String => DataType::Primitive(PrimitiveType::String),
            // PayloadKeyType::Integer => todo!(),
            // PayloadKeyType::Real => todo!(),
            PayloadKeyType::Boolean => DataType::Primitive(PrimitiveType::bool),
            // PayloadKeyType::Date => todo!(),
            // PayloadKeyType::Data => todo!(),
            // PayloadKeyType::Array => todo!(),
            // PayloadKeyType::Dictionary => todo!(),
            // PayloadKeyType::Any => todo!(),
            _ => DataType::Any, // TODO: Finish the conversion
        };

        // key.presence // TODO
        // key.rangelist // TODO
        // key.default // TODO

        s.field_mut(key.key, FieldBuilder::new(ty).docs(key.content.unwrap_or_default()));
    }

    let dt = s.build();
    types.declare(name, dt);

    // TODO: Can we somehow add impls? Like to and from yaml type thing?
}
