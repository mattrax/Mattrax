use easy_xml::{XmlDeserialize, XmlElement};
use easy_xml_derive::XmlDeserialize;

#[derive(XmlDeserialize, Debug)]
#[easy_xml(prefix = "MSFT")]
pub struct AllowedValues {
    #[easy_xml(rename = "ValueType", attribute)]
    pub value_type: ValueType,
    #[easy_xml(flatten)]
    pub values: AllowedValueGroupedNodes,
}

#[derive(Debug)]
pub enum AllowedValueGroupedNodes {
    Enum(Vec<ValueAndDescriptionGroup>),
    Value(ValueAndDescriptionGroup),
    Admx(AdmxBacked),
}

impl XmlDeserialize for AllowedValueGroupedNodes {
    fn deserialize(element: &easy_xml::XmlElement) -> Result<Self, easy_xml::de::Error>
    where
        Self: Sized,
    {
        let XmlElement::Node(node) = element else {
            return Err(easy_xml::de::Error::BadXml);
        };

        let node = node.borrow();

        let first_name = {
            let mut first_node = None;

            for element in &node.elements {
                if let XmlElement::Node(node) = element {
                    first_node = Some(node.borrow());
                    break;
                };
            }

            let Some(first_node) = first_node else {
                return Err(easy_xml::de::Error::BadXml);
            };

            first_node.name.local_name.clone()
        };

        Ok(match first_name.as_str() {
            "Enum" => Self::Enum(
                node.elements
                    .iter()
                    .filter(|e| matches!(e, XmlElement::Node(_)))
                    .map(ValueAndDescriptionGroup::deserialize)
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            "AdmxBacked" => Self::Admx(AdmxBacked::deserialize(&node.elements[0])?),
            "Value" | "ValueDescription" => {
                Self::Value(ValueAndDescriptionGroup::deserialize(element)?)
            }
            _ => return Err(easy_xml::de::Error::BadXml),
        })
    }
}

#[derive(XmlDeserialize, Debug)]
pub enum ValueType {
    ENUM,
    ADMX,
    Range,
    None,
}

#[derive(XmlDeserialize, Debug)]
#[easy_xml(prefix = "MSFT")]
pub struct ValueAndDescriptionGroup {
    #[easy_xml(prefix = "MSFT", rename = "Value")]
    pub value: String,
    #[easy_xml(prefix = "MSFT", rename = "ValueDescription")]
    pub value_description: Option<String>,
}

#[derive(XmlDeserialize, Debug)]
#[easy_xml(prefix = "MSFT")]
pub struct AdmxBacked {
    #[easy_xml(rename = "Area")]
    pub area: String,
    #[easy_xml(rename = "Nrea")]
    pub name: String,
    #[easy_xml(rename = "Frea")]
    pub file: String,
}
