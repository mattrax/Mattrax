use std::{fs::DirEntry, path::Path};

use inflector::Inflector;
use regex::{Captures, Regex};

pub fn parse(
    dir: impl AsRef<Path>,
    mut on_entry: impl FnMut(DirEntry, schemars::schema::SchemaObject),
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
        let schema: schemars::schema::SchemaObject = serde_yaml::from_str(&file)
            .map_err(|err| println!("Error parsing file {:?}: {err:?}", entry.path()))?;

        let schema2: crate::apple_schema::DMClientSchema = serde_yaml::from_str(&file).unwrap();

        on_entry(entry, schema);
    }

    Ok(())
}

pub fn generate_file(input: impl AsRef<Path>, out: impl AsRef<Path>) -> Result<(), ()> {
    let mut result = Vec::new();

    parse(input, |e, schema| {
        println!("\t processed {:?}", e.path());
        println!("\t {:#?}", schema);

        let title = schema.metadata.unwrap().title.unwrap();

        let mut s = format!("pub struct {} {{", title.to_class_case());

        // for (name, property) in schema..properties.unwrap() {
        //     let ty = match property {
        //         // schemars::schema::Schema::Bool(_) => "bool",
        //         // schemars::schema::Schema::Integer(_) => "i64",
        //         // schemars::schema::Schema::Number(_) => "f64",
        //         // schemars::schema::Schema::String(_) => "String",
        //         // schemars::schema::Schema::Array(_) => "Vec<String>",
        //         // schemars::schema::Schema::Object(_) => "serde_json::Value",
        //         // _ => "serde_json::Value",
        //         _ => "()",
        //     };

        //     s.push_str(&format!("\n\tpub {}: {},", name.to_snake_case(), ty));
        // }

        s.push_str("}");
        result.push(s);
    })?;

    std::fs::write(out, result.join("\n")).unwrap();
    Ok(())
}

pub fn parse_dm_schema(path: impl AsRef<Path>) -> Result<(), ()> {
    let path = path.as_ref();
    let file = std::fs::read_to_string(path)
        .map_err(|err| println!("Error reading file {:?}: {err:?}", path))?;

    // The Apple schema definitions have a recursive type which Rust yaml libraries don't seem to support.
    // When formatting a schema in JSON references are expressed as a `$ref` field so we convert Yaml reference into the `$ref` format.
    // https://github.com/saphyr-rs/saphyr/issues/24
    let file = Regex::new(r": \*(?<a>.*)")
        .unwrap()
        .replace_all(&file, |caps: &Captures| {
            format!(
                r##": {{ "$ref": "#/definitions/{}" }}"##,
                caps.name("a").expect("is in hardcoded regex").as_str()
            )
        })
        .to_string();

    let schema: schemars::schema::SchemaObject = serde_yaml::from_str(&file)
        .map_err(|err| println!("Error parsing file {:?}: {err:?}", path))?;

    println!("{:#?}", schema);

    Ok(())
}
