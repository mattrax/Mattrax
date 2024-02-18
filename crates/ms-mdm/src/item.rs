use easy_xml_derive::{XmlDeserialize, XmlSerialize};

use crate::Target;

/// An enum to represent all possible children for `Item`.
/// This would be better represeted as `serde_json::Value` like type but `yaserde` doesn't have one I can find. // TODO: Maybe upstream PR?
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
enum Value {
    Target(#[easy_xml(flatten)] Target), // TODO: Is this rename as intended???
}

/// The Item element type provides a container for item data.
#[derive(Debug, Clone, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub struct Item {
    // TODO: Tuple structs are broken
    #[easy_xml(flatten)] // TODO: I have a feeling this won't work how I want it to.
    child: Value,
}

impl From<Target> for Item {
    fn from(value: Target) -> Self {
        Item {
            child: Value::Target(value),
        }
    }
}

// TODO: Actually encode these rules from the spec.
// Restrictions: When the source URI for the item data is an external entity, the Data (section 2.2.5.1)
// element is not present and the recipient retrieves the data from the specified network location. When
// Data is present in Item, it MUST be the last element in Item.

// The LocURI (section 2.2.3.5) element type can be a relative URL when used in the
// Target (section 2.2.3.12) or Source (section 2.2.3.9) element types for any of the SyncML commands.
// Note that this restriction is not captured by the SyncML DTD.

// When specified in an Add, Delete, Exec, Get, Replace, or Results command, Item specifies the
// data item that is the operand for the command. When specified in Status, Item specifies additional
// information about the request status code type. For example, it might specify the component of the
// request that caused the status condition.
