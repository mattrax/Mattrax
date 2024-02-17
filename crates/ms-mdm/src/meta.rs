use yaserde::{YaDeserialize, YaSerialize};

// TODO: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/b6272c46-f152-481f-afa9-e05b96baf661

// TODO: Parent Elements: Add (section 2.2.7.1), Atomic (section 2.2.7.3), Delete (section 2.2.7.4), Get (section 2.2.7.6), Item (section 2.2.5.2), Replace (section 2.2.7.7), Results (section 2.2.7.8)

// TODO: Windows MDM extensions. I think `Meta` should probs be a HashMap????
// - Format
// - NextNonce
// - MaxMsgSize
// - Type

/// The Meta element type provides a container for meta-information about the parent element type.
#[derive(Debug, Clone, PartialEq, Eq, Hash, YaSerialize, YaDeserialize)]
pub struct Meta {}
