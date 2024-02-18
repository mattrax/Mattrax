use easy_xml_derive::{XmlDeserialize, XmlSerialize};

// TODO: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/a9ce1251-de36-49e9-8e83-4e580e23976c

/// The Cmd element type specifies the name of the SyncML command that is referenced by a Status (section 2.2.6.1) element type.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, XmlDeserialize, XmlSerialize)]
pub enum Cmd {
    Add,
    Atomic,
    Delete,
    Exec,
    Get,
    Replace,
    Results,
    Status,
    #[default] // TODO: Remove this variant. I think it's a limitation of `yaserde`.
    _Unreachable,
}
