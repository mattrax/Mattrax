use std::{
    fs,
    io::{self, ErrorKind},
    path::Path,
};

use crate::{validate_manifest, Manifest};

/// Parse a directory full of profile manifests.
pub fn parse_from_dir(path: impl AsRef<Path>) -> io::Result<Vec<Manifest>> {
    let path = path.as_ref();

    let paths = fs::read_dir(&path)
        .map_err(|err| {
            io::Error::new(
                err.kind(),
                format!("Failed to read content of directory {path:?}: {err}"),
            )
        })?
        .collect::<Result<Vec<_>, io::Error>>()
        .map_err(|err| {
            io::Error::new(
                err.kind(),
                format!("Failed to collect entries for directory {path:?}: {err}"),
            )
        })?;

    let mut manifests = Vec::with_capacity(paths.len());
    for entry in paths {
        let path = &entry.path();
        let manifest: Manifest = plist::from_file(path).map_err(|err| {
            io::Error::new(
                ErrorKind::Other,
                format!("Failed to parse manifest from {path:?}: {err}"),
            )
        })?;

        for err in validate_manifest(&manifest) {
            return Err(io::Error::new(
                ErrorKind::Other,
                format!("Failed to validate manifest from {path:?}: {err}"),
            ));
        }

        manifests.push(manifest);
    }

    Ok(manifests)
}
