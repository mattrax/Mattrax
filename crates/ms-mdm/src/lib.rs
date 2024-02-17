//! Type for the [MS-MDM](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-mdm/33769a92-ac31-47ef-ae7b-dc8501f7104f) protocol.
//!
//! These types are modelled directly after the specification however given the lack of consistency within itself I have deviated based on how the Windows client implementation works.

// TODO: Should validation be done in Serde or keep in the separate function?

mod add;
mod alert;
mod atomic;
mod cmd;
mod cmd_id;
mod cmd_ref;
mod data;
mod delete;
mod exec;
mod r#final;
mod get;
mod item;
mod meta;
mod mode;
mod msg_ref;
mod replace;
mod results;
mod routing;
mod session_id;
mod status;
mod sync_body;
mod sync_hdr;
mod sync_ml;

pub use add::Add;
pub use alert::{Alert, AlertType};
pub use atomic::Atomic;
pub use cmd::Cmd;
pub use cmd_id::CmdId;
pub use cmd_ref::CmdRef;
pub use data::Data;
pub use delete::Delete;
pub use exec::Exec;
pub use get::Get;
pub use item::{Item, Value};
pub use meta::Meta;
pub use mode::Mode;
pub use msg_ref::MsgRef;
pub use r#final::Final;
pub use replace::Replace;
pub use results::Results;
pub use routing::{Source, Target};
pub use session_id::SessionId;
pub use status::Status;
pub use sync_body::{SyncBody, SyncBodyChild, MSFT_XMLNS};
pub use sync_hdr::SyncHdr;
pub use sync_ml::{SyncML, SYNCML_XMLNS};
