//! This file is just a bunch of tests to ensure `yaserde` works as expected.

use easy_xml_derive::{XmlDeserialize, XmlSerialize};
use pretty_assertions::assert_eq;

#[test]
fn test_identically_named_children() {
    #[derive(XmlDeserialize, Debug, PartialEq, Eq)]
    #[easy_xml(root)]
    pub struct Container {
        #[easy_xml(rename = "Elem")]
        pub elems: Vec<String>,
    }

    let input = r#"<Container><Elem>a</Elem><Elem>b</Elem></Container>"#;
    assert_eq!(
        easy_xml::de::from_str::<Container>(input).unwrap(),
        Container {
            elems: vec!["a".into(), "b".into()]
        }
    );
}

#[test]
fn test_differently_named_children() {
    #[derive(XmlDeserialize, Debug, PartialEq, Eq)]
    #[easy_xml(root)]
    pub struct Container {
        #[easy_xml(rename = "A|B", enum)]
        pub elems: Vec<Element>,
    }

    #[derive(XmlDeserialize, Debug, PartialEq, Eq)]
    pub enum Element {
        A(#[easy_xml(text)] String),
        B(#[easy_xml(text)] String),
    }

    let input = r#"<Container><A>a</A><B>b</B></Container>"#;
    assert_eq!(
        easy_xml::de::from_str::<Container>(input).unwrap(),
        Container {
            elems: vec![Element::A("a".into()), Element::B("b".into())]
        }
    );
}

#[test]
fn test_differently_named_children_plus_static_value() {
    #[derive(XmlDeserialize, XmlSerialize, Debug, PartialEq, Eq)]
    #[easy_xml(root)]
    pub struct Container {
        #[easy_xml(rename = "Test")]
        pub test: String,
        #[easy_xml(rename = "A|B", enum)] // TODO: this is kinda cringe
        pub elems: Vec<Element>,
    }

    #[derive(XmlDeserialize, XmlSerialize, Debug, PartialEq, Eq)]
    pub enum Element {
        A(#[easy_xml(text)] String),
        B(#[easy_xml(text)] String),
    }

    let input = r#"<Container><Test>Testing</Test><A>a</A><B>b</B>><A>c</A></Container>"#;
    let result = easy_xml::de::from_str::<Container>(input).unwrap();
    assert_eq!(
        result,
        Container {
            test: "Testing".into(),
            elems: vec![
                Element::A("a".into()),
                Element::B("b".into()),
                Element::A("c".into())
            ]
        }
    );
    assert_eq!(
        easy_xml::se::to_string(&result).unwrap(),
        r#"<?xml version="1.0" encoding="UTF-8"?><Container><Test>Testing</Test><A>a</A><B>b</B><A>c</A></Container>"#
    );
}

#[test]
fn test_with_an_inner_enum() {
    #[derive(XmlDeserialize, XmlSerialize, Debug, PartialEq, Eq)]
    #[easy_xml(root)]
    pub struct Container {
        #[easy_xml(rename = "Test")]
        pub test: String,
        #[easy_xml(rename = "A|B", enum)] // TODO: this is kinda cringe
        pub elems: Vec<Element>,
    }

    #[derive(XmlDeserialize, XmlSerialize, Debug, PartialEq, Eq)]
    pub struct Testing {
        #[easy_xml(rename = "Test")]
        pub test: String,
    }

    #[derive(XmlDeserialize, XmlSerialize, Debug, PartialEq, Eq)]
    pub enum Element {
        A(#[easy_xml(flatten)] Testing),
        B(#[easy_xml(flatten)] Testing),
    }

    let input = r#"<Container><Test>Testing</Test><A><Test>a</Test></A><B><Test>b</Test></B>><A><Test>c</Test></A></Container>"#;
    let result = easy_xml::de::from_str::<Container>(input).unwrap();
    assert_eq!(
        result,
        Container {
            test: "Testing".into(),
            elems: vec![
                Element::A(Testing { test: "a".into() }),
                Element::B(Testing { test: "b".into() }),
                Element::A(Testing { test: "c".into() }),
            ]
        }
    );
    assert_eq!(
        easy_xml::se::to_string(&result).unwrap(),
        r#"<?xml version="1.0" encoding="UTF-8"?><Container><Test>Testing</Test><A><Test>a</Test></A><B><Test>b</Test></B><A><Test>c</Test></A></Container>"#
    );
}
