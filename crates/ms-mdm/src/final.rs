use yaserde::{YaDeserialize, YaSerialize};

/// The Final element type indicates that a SyncML message is the last message in the current SyncML package.
#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Final;

impl YaSerialize for Final {
    fn serialize<W: std::io::prelude::Write>(
        &self,
        writer: &mut yaserde::ser::Serializer<W>,
    ) -> Result<(), String> {
        writer
            .write(xml::writer::XmlEvent::start_element("Final"))
            .map_err(|err| err.to_string())?;
        writer
            .write(xml::writer::XmlEvent::end_element())
            .map_err(|err| err.to_string())?;
        Ok(())
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

impl YaDeserialize for Final {
    fn deserialize<R: std::io::prelude::Read>(
        reader: &mut yaserde::de::Deserializer<R>,
    ) -> Result<Self, String> {
        let y = reader.next_event()?;
        let x = reader.next_event()?;
        Ok(Final)
    }
}
