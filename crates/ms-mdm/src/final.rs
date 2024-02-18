use easy_xml::{XmlDeserialize, XmlSerialize};

/// The Final element type indicates that a SyncML message is the last message in the current SyncML package.
#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Final;

impl XmlSerialize for Final {
    fn serialize(&self, _element: &mut easy_xml::XmlElement)
    where
        Self: Sized,
    {
    }
}

impl XmlDeserialize for Final {
    fn deserialize(_element: &easy_xml::XmlElement) -> Result<Self, easy_xml::de::Error>
    where
        Self: Sized,
    {
        Ok(Final)
    }
}
