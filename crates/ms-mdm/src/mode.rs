use std::str::FromStr;

/// The 'mode' query parameter specifies the mode in which the MDM client is launched.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Mode {
    /// The MDM client is launched when there is an active user login.
    Maintenance,
    /// The MDM client is launched in the System context and the client does not have access to the user's profile.
    Machine,
}

impl Mode {
    pub fn as_str(&self) -> &str {
        match self {
            Mode::Maintenance => "maintenance",
            Mode::Machine => "machine",
        }
    }
}

impl FromStr for Mode {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "maintenance" => Ok(Mode::Maintenance),
            "machine" => Ok(Mode::Machine),
            _ => Err(()),
        }
    }
}
