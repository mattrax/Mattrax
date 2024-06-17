use specta::{
    ts::{BigIntExportBehavior, ExportConfig},
    TypeCollection,
};
use std::{path::PathBuf, process::Command};

#[test]
pub fn export() {
    let mut col = TypeCollection::default();
    col.register::<mx_policy::Policy>();
    let result = col
        .export_ts(&ExportConfig::default().bigint(BigIntExportBehavior::Number))
        .unwrap();

    std::fs::write(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/policy/src/types.ts"),
        format!("//! This file is generated by the 'export' unit test in 'mx-policy'! Do not modify it manually!\n\n{result}")
    )
    .unwrap();

    Command::new("pnpm").args(["format"]).status().unwrap();
}
