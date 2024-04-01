use std::collections::HashMap;

#[derive(Debug)]
pub struct Deploy {
    // Primary key of the deploy
    pk: u64,
    // The rendered MDM configuration
    configuration: HashMap<String, ()>,
}

pub enum Entry {
    Bool(bool, ()),
    Conflict(()),
}

// TODO: How do we deal with conflict

// TODO: Deduplicate the following stuff???

// #[derive(Debug, Clone)]
// pub struct CustomConfiguration {
//     pub oma_uri: String,
//     // TODO: Handle datatype's exactly like Intune
//     pub value: AnyValue,
// }
