//! This script generates the `apple-dm` crate using the Schema defined in this crate.
//!
//! Must run before running this script:
//!  - git submodule update --init
//!
//! Run to update the downstream module:
//!  - git submodule update --remote

use std::{fs::DirEntry, path::{Path, PathBuf}};
use apple_dm_schema::{PayloadKeyType, Presence};
use inflector::Inflector;
use specta::{builder::{EnumBuilder, FieldBuilder, NamedDataTypeBuilder, StructBuilder, VariantBuilder}, datatype::{reference::Reference, DataType, EnumRepr, PrimitiveType}, TypeCollection};
use specta_rust::Rust;
use quote::quote;

fn main() -> Result<(), ()> {
    println!("Generating `apple-dm` crate...");
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // TODO: All the declarative stuff

    {
        let mut types = TypeCollection::default();

        let commands = parse(
            base.join("../../vendor/device-management/mdm/checkin"),
            |_, schema| export(&mut types, schema)
        )?;

        let mut e = EnumBuilder::new("CheckinCommand").repr(EnumRepr::Internal { tag: "MessageType".into() });
        for (schema, dt_reference) in commands {
            let identifier = schema.payload.unwrap().requesttype.unwrap();
            // let ndt = types.get(dt_reference.sid()).unwrap();
            e.variant_mut(
                // TODO: We should use `ndt.name()` here, but we need: https://github.com/specta-rs/specta/issues/332
                // TODO: In practice we are lucky they match but that's coincidence.
                identifier,
                VariantBuilder::unnamed()
                    .docs(schema.description.unwrap_or_default().into())
                    .field(FieldBuilder::new(DataType::Reference(dt_reference))
                    .build()
            ).build());
        }
        types.declare(NamedDataTypeBuilder::new("CheckinCommand", e.build()).docs("A command sent by the device during MDM checkin.").build());

        let impls = quote! {
            impl CheckinCommand {
                pub fn from_str(s: &str) -> Result<Self, serde_yaml::Error> {
                    serde_yaml::from_str(s)
                }

                pub fn to_string(&self) -> Result<String, serde_yaml::Error> {
                    serde_yaml::to_string(self)
                }
            }
        };

        Rust::default()
            .with_any("serde_yaml::Value")
            .append(&impls.to_string())
            .export_to(base.join("../apple-dm/src/mdm/checkin.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/commands"),
            |_, schema| export(&mut types, schema)
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("serde_yaml::Value")
            .append(&impls.to_string())
            .export_to(base.join("../apple-dm/src/mdm/commands.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/errors"),
            |_, schema| export(&mut types, schema)
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("serde_yaml::Value")
            .append(&impls.to_string())
            .export_to(base.join("../apple-dm/src/mdm/errors.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/profiles"),
            |_, schema| export(&mut types, schema)
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("serde_yaml::Value")
            .append(&impls.to_string())
            .export_to(base.join("../apple-dm/src/mdm/profiles.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/other"),
            |_, schema| export(&mut types, schema)
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("serde_yaml::Value")
            .append(&impls.to_string())
            .export_to(base.join("../apple-dm/src/mdm/other.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    println!("Done!");
    Ok(())
}

pub fn parse<T>(
    dir: impl AsRef<Path>,
    mut on_entry: impl FnMut(DirEntry, apple_dm_schema::Schema) -> T,
) -> Result<Vec<T>, ()> {
    let entries = std::fs::read_dir(&dir)
        .map_err(|err| println!("Error parsing directory {:?}: {err:?}", dir.as_ref()))?;
    let mut results = vec![];

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
        results.push(on_entry(entry, schema));
    }

    Ok(results)
}

pub fn export(types: &mut TypeCollection, schema: apple_dm_schema::Schema) -> (apple_dm_schema::Schema, Reference) {
    let mut name = schema.title.to_class_case();

    // TODO: Don't do this?
    if name.starts_with("8021X") {
        name = format!("TODO{name}");
    }

    let mut s = StructBuilder::named(name.clone());
    for key in schema.payloadkeys.clone().into_iter().flatten() {
        let mut ty = match key.key_type {
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

        let presence = key.presence.unwrap_or(Presence::Required); // TODO: Is this the correct default?
        if presence == Presence::Optional {
            ty = DataType::Nullable(Box::new(ty))
        };

        // key.rangelist // TODO
        // key.default // TODO

        s.field_mut(key.key, FieldBuilder::new(ty).docs(key.content.unwrap_or_default()));
    }

    let dt = s.build();
    let reference = types.declare(NamedDataTypeBuilder::new(name, dt).docs(schema.description.clone().unwrap_or_default()).build());
    (schema, reference)
}
