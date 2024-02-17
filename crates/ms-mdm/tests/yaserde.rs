//! This file is just a bunch of tests to ensure `yaserde` works as expected.

use pretty_assertions::assert_eq;
use yaserde::YaDeserialize;

#[test]
fn test_identically_named_children() {
    #[derive(YaDeserialize, Debug, PartialEq, Eq)]
    pub struct Container {
        #[yaserde(rename = "Elem")]
        pub elems: Vec<String>,
    }

    let input = r#"<Container><Elem>a</Elem><Elem>b</Elem></Container>"#;
    assert_eq!(
        yaserde::de::from_str::<Container>(input).unwrap(),
        Container {
            elems: vec!["a".into(), "b".into()]
        }
    );
}

#[test]
fn test_differently_named_children() {
    #[derive(YaDeserialize, Debug, PartialEq, Eq)]
    pub struct Container {
        pub test: String,
        #[yaserde(flatten)]
        pub elems: Vec<Element>,
    }

    #[derive(YaDeserialize, Debug, PartialEq, Eq, Default)]
    #[yaserde(flatten)]
    pub enum Element {
        A(String),
        B(String),
        #[default] // TODO: `yaserde` doesn't allow enum's without a default variant :(
        _Unreachable,
    }

    let input = r#"<Container><Test>Testing</Test><A>a</A><B>b</B></Container>"#;
    assert_eq!(
        yaserde::de::from_str::<Container>(input).unwrap(),
        Container {
            test: "Testing".into(),
            elems: vec![Element::A("a".into()), Element::B("b".into())]
        }
    );
    panic!("success"); // TODO
}
