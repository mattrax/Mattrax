//! Small pure helpers shared by the agent and the update tooling.

use std::path::Path;

/// FNV-1a (64-bit), the same fingerprint the Swift agent used. The state file
/// is compatible across the rewrite.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;

    for byte in bytes {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01b3);
    }

    hash
}

pub fn fnv1a64_hex(bytes: &[u8]) -> String {
    format!("{:x}", fnv1a64(bytes))
}

/// Lowercase hex, the format used for state digests since 1.0.
pub fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }

    out
}

/// `count` random bytes as lowercase hex. Used for the synthetic run id of a
/// trigger run, where the server did not supply one.
pub fn random_hex(count: usize) -> String {
    let mut bytes = vec![0u8; count];

    if getrandom::getrandom(&mut bytes).is_err() {
        // getrandom failing is effectively impossible on a supported OS; a
        // time-derived id keeps the run identifiable rather than aborting.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let fallback = format!("{now}-{}", std::process::id());

        return hex_lower(&fnv1a64(fallback.as_bytes()).to_be_bytes());
    }

    hex_lower(&bytes)
}

/// Read at most `limit` bytes while still draining `reader` to EOF, so a
/// noisy child cannot block on a full pipe.
pub fn read_capped<R: std::io::Read>(
    reader: &mut R,
    limit: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut kept = Vec::with_capacity(limit.min(8192));
    let mut buffer = [0u8; 8192];
    let mut truncated = false;

    loop {
        let read = reader.read(&mut buffer)?;

        if read == 0 {
            break;
        }

        if kept.len() < limit {
            let remaining = limit - kept.len();
            let take = remaining.min(read);
            kept.extend_from_slice(&buffer[..take]);

            if take < read {
                truncated = true;
            }
        } else {
            truncated = true;
        }
    }

    Ok((kept, truncated))
}

/// A path's file name, or the whole path when it has none.
pub fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}
