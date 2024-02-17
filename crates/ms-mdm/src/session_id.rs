use std::{
    io::{Read, Write},
    str::FromStr,
};

use yaserde::{YaDeserialize, YaSerialize};

/// The SessionID element type specifies the identifier of the SyncML session that is associated with the SyncML message.
/// The SessionID can remain valid across the exchange of many SyncML messages between the client and server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId([u8; 8 * 4]);

impl SessionId {
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).expect("validated in 'YaDeserialize'")
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

impl YaSerialize for SessionId {
    fn serialize<W: Write>(&self, writer: &mut yaserde::ser::Serializer<W>) -> Result<(), String> {
        writer.write(self.as_str()).map_err(|err| err.to_string())
    }

    fn serialize_attributes(
        &self,
        attributes: Vec<xml::attribute::OwnedAttribute>,
        namespace: xml::namespace::Namespace,
    ) -> Result<
        (
            Vec<xml::attribute::OwnedAttribute>,
            xml::namespace::Namespace,
        ),
        String,
    > {
        Ok((attributes, namespace))
    }
}

impl YaDeserialize for SessionId {
    fn deserialize<R: Read>(reader: &mut yaserde::de::Deserializer<R>) -> Result<Self, String> {
        loop {
            match reader.next_event()? {
                xml::reader::XmlEvent::StartElement { .. } => {}
                xml::reader::XmlEvent::Characters(ref s) => {
                    return Ok(Self(
                        try_into_or_pad(s.as_bytes()).ok_or(format!("Invalid SessionId: '{s}'"))?,
                    ));
                }
                _ => {
                    break;
                }
            }
        }
        Err("Unable to parse attribute".to_string())
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
