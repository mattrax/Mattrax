//! This script generates the `apple-dm` crate using the Schema defined in this crate.
//!
//! Must run before running this script:
//!  - git submodule update --init
//!
//! Run to update the downstream module:
//!  - git submodule update --remote

use apple_dm_schema::{PayloadKey, PayloadKeyType, Presence, RangeListItem};
use inflector::Inflector;
use quote::quote;
use specta::{
    builder::{EnumBuilder, FieldBuilder, NamedDataTypeBuilder, StructBuilder, VariantBuilder},
    datatype::{reference::Reference, DataType, EnumRepr, List, PrimitiveType},
    Type, TypeCollection,
};
use specta_rust::Rust;
use std::{
    fs::DirEntry,
    path::{Path, PathBuf},
};

fn main() -> Result<(), ()> {
    println!("Generating `apple-dm` crate...");
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // TODO: All the declarative stuff

    {
        let mut types = TypeCollection::default();

        let commands = parse(
            base.join("../../vendor/device-management/mdm/checkin"),
            |_, schema| export(&mut types, schema),
        )?;

        let mut e = EnumBuilder::new("CheckinCommand").repr(EnumRepr::Internal {
            tag: "MessageType".into(),
        });
        for (schema, dt_reference) in commands {
            let identifier = schema.payload.unwrap().requesttype.unwrap();
            // let ndt = types.get(dt_reference.sid()).unwrap();
            e.variant_mut(
                // TODO: We should use `ndt.name()` here, but we need: https://github.com/specta-rs/specta/issues/332
                // TODO: In practice we are lucky they match but that's coincidence.
                identifier,
                VariantBuilder::unnamed()
                    .docs(schema.description.unwrap_or_default().into())
                    .field(FieldBuilder::new(DataType::Reference(dt_reference)).build())
                    .build(),
            );
        }
        types.declare(
            NamedDataTypeBuilder::new("CheckinCommand", e.build())
                .docs("A command sent by the device during MDM checkin.")
                .build(),
        );

        let impls = quote! {
            impl CheckinCommand {
                pub fn from_bytes(s: &[u8]) -> Result<Self, plist::Error> {
                    plist::from_bytes(s)
                }

                pub fn to_string(&self) -> Result<Vec<u8>, plist::Error> {
                    let mut buf = Vec::new();
                    plist::to_writer_xml(&mut buf, self)?;
                    Ok(buf)
                }
            }
        };

        Rust::default()
            .with_any("plist::Value")
            .append(&impls.to_string())
            // https://github.com/ebarnard/rust-plist/pull/55#issuecomment-771113306
            .append(PLIST_SERDE_PATCH)
            .custom_attributes(
                r#"deserialize_with = "deserialize_some", serialize_with = "serialize_some","#,
            )
            .export_to(base.join("../apple-dm/src/mdm/checkin.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/commands"),
            |_, schema| export(&mut types, schema),
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("plist::Value")
            .append(&impls.to_string())
            // https://github.com/ebarnard/rust-plist/pull/55#issuecomment-771113306
            .append(PLIST_SERDE_PATCH)
            .custom_attributes(
                r#"deserialize_with = "deserialize_some", serialize_with = "serialize_some","#,
            )
            .export_to(base.join("../apple-dm/src/mdm/commands.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/errors"),
            |_, schema| export(&mut types, schema),
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("plist::Value")
            .append(&impls.to_string())
            // https://github.com/ebarnard/rust-plist/pull/55#issuecomment-771113306
            .append(PLIST_SERDE_PATCH)
            .custom_attributes(
                r#"deserialize_with = "deserialize_some", serialize_with = "serialize_some","#,
            )
            .export_to(base.join("../apple-dm/src/mdm/errors.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/mdm/profiles"),
            |_, schema| export(&mut types, schema),
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("plist::Value")
            .append(&impls.to_string())
            // https://github.com/ebarnard/rust-plist/pull/55#issuecomment-771113306
            .append(PLIST_SERDE_PATCH)
            .custom_attributes(
                r#"deserialize_with = "deserialize_some", serialize_with = "serialize_some","#,
            )
            .export_to(base.join("../apple-dm/src/mdm/profiles.rs"), &types)
            .map_err(|err| println!("Error generating Rust code: {}", err))?;
    }

    {
        let mut types = TypeCollection::default();

        parse(
            base.join("../../vendor/device-management/other"),
            |_, schema| export(&mut types, schema),
        )?;

        let impls = quote! {
            // TODO
        };

        Rust::default()
            .with_any("plist::Value")
            .append(&impls.to_string())
            // https://github.com/ebarnard/rust-plist/pull/55#issuecomment-771113306
            .append(PLIST_SERDE_PATCH)
            .custom_attributes(
                r#"deserialize_with = "deserialize_some", serialize_with = "serialize_some","#,
            )
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

fn datatype(types: &mut TypeCollection, key: &PayloadKey, parent_name: String) -> DataType {
    let mut ty = if let Some(rangelist) = &key.rangelist {
        let keyy = format!("{parent_name}{}", key.key).to_class_case();
        let mut e = EnumBuilder::new(keyy.clone());
        for range in rangelist {
            let mut item = match range {
                RangeListItem::String(s) => s.to_string(),
                // Apple's schema's don't given enough information for enum generation which is mega cringe
                RangeListItem::Integer(..) | RangeListItem::Number(..) => {
                    return DataType::Primitive(PrimitiveType::i64); // TODO: Which Rust type is correct?
                }
            };

            // For `TLSMinimumVersion` which exposes `1.0`, etc as variants.
            if item
                .chars()
                .next()
                .map(|v| v.is_digit(10))
                .unwrap_or_default()
            {
                item = format!("Version{item}");
            }

            e.variant_mut(item, VariantBuilder::unit().build());
        }

        let reference = types.declare(NamedDataTypeBuilder::new(keyy, e.build()).build());
        DataType::Reference(reference)

        // let todo = match key.key_type {
        //     PayloadKeyType::Array => DataType::List(List::new(dt.clone())),
        //     _ => dt.clone(),
        // };

        // if key.key == "ServerCapabilitiesItems" {
        //     todo!("{:?} {:?}", todo, key);
        // }

        // println!("{:?}", key.key);

        // match key.key_type {
        //     PayloadKeyType::Array => DataType::List(List::new(dt)),
        //     _ => dt,
        // }
    } else {
        match key.key_type {
            PayloadKeyType::String => DataType::Primitive(PrimitiveType::String),
            PayloadKeyType::Integer => DataType::Primitive(PrimitiveType::i64), // TODO: Which Rust type is correct?
            PayloadKeyType::Real => DataType::Primitive(PrimitiveType::f64), // TODO: Which Rust type is correct?
            PayloadKeyType::Boolean => DataType::Primitive(PrimitiveType::bool),
            PayloadKeyType::Date => DataType::Primitive(PrimitiveType::String), // TODO: Should we use a datetime library?
            PayloadKeyType::Data => <Vec<u8> as Type>::definition(types),
            PayloadKeyType::Array => {
                if key
                    .subkeys
                    .as_ref()
                    .map(|v| v.len() == 1)
                    .unwrap_or_default()
                {
                    let first = key.subkeys.clone().into_iter().flatten().next().unwrap();

                    let mut dt = datatype(
                        types,
                        &first,
                        format!("{parent_name}{}", key.key).to_class_case(),
                    );
                    // if first.key_type == PayloadKeyType::Array {
                    //     dt = DataType::List(List::new(dt));
                    // }
                    // dt
                    DataType::List(List::new(dt))
                } else {
                    let name = format!("{parent_name}{}", key.key).to_class_case();
                    let mut s = EnumBuilder::new(name.clone());

                    for key in key.subkeys.clone().into_iter().flatten() {
                        s.variant_mut(
                            key.key.clone(),
                            VariantBuilder::unnamed()
                                .field(
                                    FieldBuilder::new(datatype(types, &key, name.clone())).build(),
                                )
                                .build(),
                        );
                    }

                    let dt = s.build();
                    let reference = types.declare(
                        NamedDataTypeBuilder::new(name, dt)
                            // .docs(schema.description.clone().unwrap_or_default())
                            .build(),
                    );

                    let mut dt = DataType::List(List::new(DataType::Reference(reference.clone())));

                    // For some reason Apple put the `repetition` on the inner field not the container.
                    // let mut repetition = key.repetition.clone();
                    // println!(
                    //     "{:?} {:?}",
                    //     key.key,
                    //     key.subkeys
                    //         .as_ref()
                    //         .map(|v| v.len() == 1)
                    //         .unwrap_or_default()
                    // );
                    // if repetition.is_none()
                    //     && key
                    //         .subkeys
                    //         .as_ref()
                    //         .map(|v| v.len() == 1)
                    //         .unwrap_or_default()
                    // {
                    //     repetition = key
                    //         .subkeys
                    //         .clone()
                    //         .unwrap()
                    //         .first()
                    //         .unwrap()
                    //         .repetition
                    //         .clone();
                    //     println!("{:?}", repetition);
                    // }

                    // if let Some(rep) = &repetition {
                    //     todo!();
                    //     // TODO: We can't handle when they don't match yet.
                    //     // if rep.max == rep.min {
                    //     dt = DataType::List(List::new_with_len(
                    //         DataType::Reference(reference),
                    //         rep.max.try_into().unwrap(),
                    //     ));
                    //     // }
                    // }
                    dt
                }
            }
            PayloadKeyType::Dictionary => {
                let name = format!("{parent_name}{}", key.key).to_class_case();
                let mut s = StructBuilder::named(name.clone());

                for key in key.subkeys.clone().into_iter().flatten() {
                    s.field_mut(
                        key.key.clone(),
                        FieldBuilder::new(datatype(types, &key, name.clone())),
                    );
                }

                let dt = s.build();
                let reference = types.declare(
                    NamedDataTypeBuilder::new(name, dt)
                        // .docs(schema.description.clone().unwrap_or_default())
                        .build(),
                );
                DataType::Reference(reference)
            }
            PayloadKeyType::Any => DataType::Any,
        }
    };

    // TODO: Is this a good solution or should we generate many types/runtime validation based on the OS?
    // TODO: This should inherit from `payload.supportedOS`
    let mut optional_override = key
        .supportedOS
        .clone()
        .map(|v| {
            // If any are none, not all OSes are supported and hence field is optional.
            if v.iOS.is_none()
                || v.macOS.is_none()
                || v.tvOS.is_none()
                || v.visionOS.is_none()
                || v.watchOS.is_none()
            {
                return true;
            }

            // If it's not supported on all channels, it's optional.
            if v.iOS
                .map(|v| v.devicechannel == Some(false))
                .unwrap_or_default()
                || v.macOS
                    .map(|v| v.devicechannel == Some(false))
                    .unwrap_or_default()
                || v.tvOS
                    .map(|v| v.devicechannel == Some(false))
                    .unwrap_or_default()
                || v.visionOS
                    .map(|v| v.devicechannel == Some(false))
                    .unwrap_or_default()
                || v.watchOS
                    .map(|v| v.devicechannel == Some(false))
                    .unwrap_or_default()
            {
                return true;
            }

            false
        })
        .unwrap_or_default();

    // TODO: Remove this hack. I've observed this field not existing on macOS checkin
    if key.key == "EnrollmentID" {
        optional_override = true;
    }

    let presence = key.presence.unwrap_or(Presence::Required); // TODO: Is this the correct default?
    if optional_override || presence == Presence::Optional {
        ty = DataType::Nullable(Box::new(ty))
    };

    // key.default // TODO

    ty
}

pub fn export(
    types: &mut TypeCollection,
    mut schema: apple_dm_schema::Schema,
) -> (apple_dm_schema::Schema, Reference) {
    let mut name = schema.title.to_class_case();

    // TODO: Don't do this?
    if name.starts_with("8021X") {
        name = format!("TODO{name}");
    }

    let mut s = StructBuilder::named(name.clone());

    // We flatten for consistency. Apple's schema's are inconsistent as hell.
    if &schema
        .payloadkeys
        .clone()
        .into_iter()
        .flatten()
        .map(|v| v.key.clone())
        .collect::<Vec<_>>()
        == &["PayloadContent"]
    {
        let first = schema
            .payloadkeys
            .clone()
            .into_iter()
            .flatten()
            .next()
            .unwrap();
        schema.payloadkeys = first.subkeys;
    }

    for key in schema.payloadkeys.clone().into_iter().flatten() {
        // This is handled by the enum
        if key.key == "MessageType" {
            continue;
        }

        let ty = datatype(types, &key, name.clone());
        s.field_mut(
            key.key,
            FieldBuilder::new(ty).docs(key.content.unwrap_or_default()),
        );
    }

    let dt = s.build();
    let reference = types.declare(
        NamedDataTypeBuilder::new(name, dt)
            .docs(schema.description.clone().unwrap_or_default())
            .build(),
    );
    (schema, reference)
}

// https://github.com/ebarnard/rust-plist/pull/55#issuecomment-771113306
static PLIST_SERDE_PATCH: &str = r##"fn deserialize_some<'de, D, T>(de: D) -> Result<Option<T>, D::Error>
where
    D: serde::de::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(de).map(Some)
}

fn serialize_some<S, T>(value: &Option<T>, ser: S) -> Result<S::Ok, S::Error>
where
    S: serde::ser::Serializer,
    T: Serialize,
{
    value
        .as_ref()
        .expect(
            r#"`serialize_some` must be used with `skip_serializing_if = "Option::is_none"`"#,
        )
        .serialize(ser)
}"##;
