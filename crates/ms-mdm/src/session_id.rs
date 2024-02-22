use std::{cell::RefCell, rc::Rc, str::FromStr};

use easy_xml::{XmlDeserialize, XmlSerialize};
use xml::{name::OwnedName, namespace::Namespace};

/// The SessionID element type specifies the identifier of the SyncML session that is associated with the SyncML message.
/// The SessionID can remain valid across the exchange of many SyncML messages between the client and server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId([u8; 8 * 4]);

impl SessionId {
    pub fn as_str(&self) -> String {
        std::str::from_utf8(&self.0)
            .expect("validated in 'YaDeserialize'")
            // TODO: Do this properly + return `&str` not `String`
            .replace("\0", "")
    }
}

impl From<u16> for SessionId {
    fn from(value: u16) -> Self {
        println!("{:?}", value.to_string().as_bytes());
        Self(
            try_into_or_pad(value.to_string().as_bytes())
                .expect("u16::MAX is 5 bytes hence not larger than 8 * 4 bytes"),
        )
    }
}

impl FromStr for SessionId {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(try_into_or_pad(s.as_bytes()).ok_or(())?))
    }
}

impl XmlSerialize for SessionId {
    fn serialize(&self, element: &mut easy_xml::XmlElement)
    where
        Self: Sized,
    {
        *element = easy_xml::XmlElement::Node(Rc::new(RefCell::new(easy_xml::XmlNode {
            name: OwnedName::local("SessionID"),
            attributes: vec![],
            namespace: Namespace::empty(),
            elements: vec![easy_xml::XmlElement::Text(self.as_str().into())],
            parent: None,
        })));
    }
}

impl XmlDeserialize for SessionId {
    fn deserialize(element: &easy_xml::XmlElement) -> Result<Self, easy_xml::de::Error>
    where
        Self: Sized,
    {
        let mut s = String::new();
        element.text(&mut s);
        Ok(Self(try_into_or_pad(s.as_bytes()).ok_or(
            easy_xml::de::Error::Other(format!("Invalid SessionId: '{s}'")),
        )?))
    }
}

// `.try_into()` fails if the length doesn't match exactly.
// This function pads with zero's to the correct length.
fn try_into_or_pad<const N: usize>(arr: &[u8]) -> Option<[u8; N]> {
    (arr.len() <= N).then(|| {
        let mut b = [0; N];
        b[..arr.len()].copy_from_slice(&arr);
        b
    })
}
