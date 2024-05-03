use serde::{Deserialize, Serialize};

// TODO: Specta exporting so this can be on the frontend

#[derive(Debug, Serialize, Deserialize)]
pub struct Result {
    /// A list of conflicts found in between this policy and other policies.
    /// This also contains instructions on how they were resolve.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    conflicts: Vec<()>,

    /// A list of errors that occurred while deploying the policy.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    errors: Vec<()>,

    /// Mark this policy as being removed from the device.
    /// This will be set once a policy has been successfully removed from the device.
    /// It will only be set on the last deployed version of the policy.
    /// It is triggered by the policy being moved out of the devices scope (Eg. having a policyDeployStatus but not assignment)
    #[serde(default, skip_serializing_if = "is_false")]
    removed: bool,
}

fn is_false(b: &bool) -> bool {
    !b
}
