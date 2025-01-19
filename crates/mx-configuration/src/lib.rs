//! TODO

#[derive(Debug, Clone, PartialEq, Eq, Hash)] // TODO: Serde?
pub enum Configuration {
    // TODO: Can we just embed the codegen output into here for now?
    CustomApple {},
    CustomWindows {
        uri: String,
    }
}

impl Configuration {
    // TODO: What is the return type?
    pub fn supported_scope(&self) {
        match self {
            Configuration::CustomApple { .. } => todo!(),
            Configuration::CustomWindows { uri } => {
                let user = uri.starts_with("./TODO/User");
                // If it's not user we assume it's device

                todo!();
            }
        }
    }
}

// TODO: OS support
// TODO: OS version support
// TODO: User vs device support

// TODO: Conflict resolution
// TODO: Lowering into native MDM
