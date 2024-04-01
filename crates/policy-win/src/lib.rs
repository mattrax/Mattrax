use mx_policy::{Configuration, Policy, SupportMatrix};

/// TODO
pub fn render(policy: Policy) {
    for configuration in policy.configurations {
        match configuration {
            // Configuration::Slack { auto_update } => {
            //     todo!()
            // }
            _ => unimplemented!(),
        }
    }

    // TODO: Return SyncML
}

/// TODO
pub fn is_supported(policy: Policy) -> SupportMatrix {
    todo!();
}
