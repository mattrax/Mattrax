//! Apple Mobile Device Management implementation for Mattrax.

mod crypto;
mod device_attributes;
mod enroll;

pub use crypto::APPLE_IPHONE_DEVICE_CA;
pub use device_attributes::DeviceAttributes;
pub use enroll::{EnrollMobileConfig, EnrollMobileConfigPayloadContent};
