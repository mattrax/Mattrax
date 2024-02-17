/// The 'mode' query parameter specifies the mode in which the MDM client is launched.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Mode {
    /// The MDM client is launched when there is an active user login.
    Maintenance,
    /// The MDM client is launched in the System context and the client does not have access to the user's profile.
    Machine,
}

impl Mode {
    pub fn from_str(s: &str) -> Option<Mode> {
        match s {
            "maintenance" => Some(Mode::Maintenance),
            "machine" => Some(Mode::Machine),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Mode::Maintenance => "maintenance",
            Mode::Machine => "machine",
        }
    }
}
