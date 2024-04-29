use std::path::PathBuf;

use plist::{Date, Integer, Value};
use pretty_assertions::assert_eq;
use profile_manifests::{Manifest, Platform, Subkey, Target};

#[test]
fn test_example() {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/data"));
    let result = profile_manifests::parse_from_dir(path).unwrap();

    let expected =
        vec![Manifest {
            pfm_app_url: Some("https://github.com/erikberglund/ProfileCreator/releases".into()),
            pfm_documentation_url: Some(
                "https://github.com/erikberglund/ProfileManifests/wiki/Manifest-Format".into()
            ),
            pfm_targets: vec![Target::System, Target::User,],
            pfm_platforms: vec![Platform::MacOS],
            pfm_description: "Example Application settings".into(),
            pfm_domain: "com.github.ProfileManifests.exampleApplication".into(),
            pfm_format_version: 1,
            pfm_last_modified: Date::from_xml_format("2018-07-18T08:58:48Z".into())
                .expect("skill issue"),
            pfm_title: "Example Application".into(),
            pfm_unique: false,
            pfm_version: 1,
            pfm_subkeys: vec![Subkey {
                pfm_default: Some(Value::String(
                    "Configures Example Application configuration preferences".into()
                )),
                            pfm_description: Some(
                                "Description of the payload.".into()
                            ),
                            pfm_description_reference: Some(
                                "Optional. A human-readable description of this payload. This description is shown on the Detail screen.".into()
                            ),
                            pfm_name: "PayloadDescription".into(),
                            pfm_title: Some(
                                "Payload Description".into()
                            ),
                            pfm_type: "string".into()
            },
Subkey {
    pfm_default: Some(
        Value::String(
            "Example Application".into(),
        ),
    ),
    pfm_description: Some(
        "Name of the payload.".into(),
    ),
    pfm_description_reference: Some(
        "A human-readable name for the profile payload. This name is displayed on the Detail screen. It does not have to be unique.".into(),
    ),
    pfm_name: "PayloadDisplayName".into(),
    pfm_title: Some(
        "Payload Display Name".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: Some(
        Value::String(
            "com.github.ProfileManifests.exampleApplication".into(),
        ),
    ),
    pfm_description: Some(
        "A unique identifier for the payload, dot-delimited.  Usually root PayloadIdentifier+subidentifier".into(),
    ),
    pfm_description_reference: Some(
        "A reverse-DNS-style identifier for the specific payload. It is usually the same identifier as the root-level PayloadIdentifier value with an additional component appended.".into(),
    ),
    pfm_name: "PayloadIdentifier".into(),
    pfm_title: Some(
        "Payload Identifier".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: Some(
        Value::String(
            "com.github.ProfileManifests.exampleApplication".into(),
        ),
    ),
    pfm_description: Some(
        "The type of the payload, a reverse dns string.".into(),
    ),
    pfm_description_reference: Some(
        "The payload type.".into(),
    ),
    pfm_name: "PayloadType".into(),
    pfm_title: Some(
        "Payload Type".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "Unique identifier for the payload (format 01234567-89AB-CDEF-0123-456789ABCDEF)".into(),
    ),
    pfm_description_reference: Some(
        "A globally unique identifier for the payload. The actual content is unimportant, but it must be globally unique. In macOS, you can use uuidgen to generate reasonable UUIDs.".into(),
    ),
    pfm_name: "PayloadUUID".into(),
    pfm_title: Some(
        "Payload UUID".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: Some(
        Value::Integer(
            Integer::from(1),
        ),
    ),
    pfm_description: Some(
        "The version of the whole configuration profile.".into(),
    ),
    pfm_description_reference: Some(
        "The version number of the individual payload.\nA profile can consist of payloads with different version numbers. For example, changes to the VPN software in iOS might introduce a new payload version to support additional features, but Mail payload versions would not necessarily change in the same release.".into(),
    ),
    pfm_name: "PayloadVersion".into(),
    pfm_title: Some(
        "Payload Version".into(),
    ),
    pfm_type: "integer".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This value describes the issuing organization of the profile, as displayed to the user".into(),
    ),
    pfm_description_reference: None,
    pfm_name: "PayloadOrganization".into(),
    pfm_title: Some(
        "Payload Organization".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: None,
    pfm_description_reference: None,
    pfm_name: "ExampleString".into(),
    pfm_title: None,
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: None,
    pfm_description_reference: None,
    pfm_name: "ExampleTitle".into(),
    pfm_title: Some(
        "Example: Title".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This is the description of the ExampleDescriptions key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExampleDescriptions".into(),
    pfm_title: Some(
        "Example: Description".into(),
    ),
    pfm_type: "date".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This is the description of the ExampleRequired key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExampleRequired".into(),
    pfm_title: Some(
        "Example: Required".into(),
    ),
    pfm_type: "boolean".into(),
},
Subkey {
    pfm_default: Some(
        Value::String(
            "Default Value".into(),
        ),
    ),
    pfm_description: Some(
        "This is the description of the ExampleDefaultValue key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExampleDefaultValue".into(),
    pfm_title: Some(
        "Example: Default Value".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This is the description of the ExamplePlaceholderValue key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExamplePlaceholderValue".into(),
    pfm_title: Some(
        "Example: Placeholder Value".into(),
    ),
    pfm_type: "string".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This is the description of the ExamplePopUpButtonInteger key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExamplePopUpButtonInteger".into(),
    pfm_title: Some(
        "Example: Integer PopUp Button".into(),
    ),
    pfm_type: "integer".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This is the description of the ExampleDictinoary key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExampleDictinoary".into(),
    pfm_title: Some(
        "Example: Dictionary".into(),
    ),
    pfm_type: "dictionary".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This is the description of the ExampleArrayStrings key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExampleArrayStrings".into(),
    pfm_title: Some(
        "Example: Array of Strings".into(),
    ),
    pfm_type: "array".into(),
},
Subkey {
    pfm_default: None,
    pfm_description: Some(
        "This is the description of the ExampleArrayDictionaries key.".into(),
    ),
    pfm_description_reference: Some(
        "Optional. This is the original documentation's description".into(),
    ),
    pfm_name: "ExampleArrayDictionaries".into(),
    pfm_title: Some(
        "Example: Array of Dictionaries".into(),
    ),
    pfm_type: "array".into(),
},],
        }];

    assert_eq!(result, expected);
}
