/// TODO
pub enum Script {
    Powershell { raw: String },
    // TODO: Control macOS or Linux
    Bash { raw: String },
}

pub enum Trigger {}
