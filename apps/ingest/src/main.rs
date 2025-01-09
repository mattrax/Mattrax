//! An internal tool for automatically scaffolding types from external schemas.
//!
//! Must run before running this script:
//!  - git submodule update --init
//!
//! Run to update the downstream module:
//!  - git submodule update --remote

use std::path::PathBuf;

mod mx_apple;

fn main() -> Result<(), ()> {
    println!("Starting ingest...");
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    println!("Generating `mx-apple` crate...");
    mx_apple::generate_file(
        base.join("./device-management/mdm/checkin"),
        base.join("../../crates/mx-apple/src/checkin.rs"),
    )?;
    mx_apple::generate_file(
        base.join("./device-management/mdm/commands"),
        base.join("../../crates/mx-apple/src/commands.rs"),
    )?;
    mx_apple::generate_file(
        base.join("./device-management/mdm/errors"),
        base.join("../../crates/mx-apple/src/errors.rs"),
    )?;
    mx_apple::generate_file(
        base.join("./device-management/mdm/profiles"),
        base.join("../../crates/mx-apple/src/profiles.rs"),
    )?;

    Ok(())
}
