//! Temporary bindings to Go due to Rust's lack of good crypto libraries.
//!
//! Long term we will remove this and replace it with Rust code.
#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

use std::{io::Write, process::Stdio};

const BINARY: &[u8] = include_bytes!("../out/mxgolang");

fn run(args: &[&str], input: Vec<u8>) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    // TODO: Cache these calls
    {
        std::fs::write("./_mttx_golang", BINARY).unwrap();
        std::process::Command::new("chmod")
            .arg("+x")
            .arg("./_mttx_golang")
            .output()?;
    }

    // TODO: Checking process exit status

    let mut child = std::process::Command::new("./_mttx_golang")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    let stdin = child.stdin.as_mut().unwrap();
    stdin.write_all(&input)?;

    let output = child.wait_with_output()?;

    // TODO: Checking process exit status

    Ok(output.stdout)
}

pub fn scep_success(
    cert_der: Vec<u8>,
    key_der: Vec<u8>,
    csr: Vec<u8>,
    p7_certificates: Vec<Vec<u8>>,
    transaction_id: String,
    sender_nonce: Vec<u8>,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let out = run(
        &["pkcs_encrypt"],
        format!(
            "{}\n{}\n{}\n{}\n{}\n{}\n",
            serde_json::to_string(&cert_der).unwrap(),
            serde_json::to_string(&key_der).unwrap(),
            serde_json::to_string(&csr).unwrap(),
            serde_json::to_string(&p7_certificates).unwrap(),
            serde_json::to_string(&transaction_id).unwrap(),
            serde_json::to_string(&sender_nonce).unwrap(),
        )
        .as_bytes()
        .to_vec(),
    )?
    .trim_ascii_end()
    .to_vec();

    Ok(out)
}
