use std::{
    fs,
    io::{self, ErrorKind},
    path::Path,
};

use crate::{validate_manifest, Manifest};

/// Parse a directory full of profile manifests.
pub fn parse_from_dir(path: impl AsRef<Path>) -> io::Result<Vec<Manifest>> {
    let path = path.as_ref();
    let mut manifests = Vec::new();
    inner(path, &mut manifests)?;
    Ok(manifests)
}

fn inner(path: &Path, manifests: &mut Vec<Manifest>) -> io::Result<()> {
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

    for entry in paths {
        let path = &entry.path();

        if entry
            .metadata()
            .map_err(|err| {
                io::Error::new(
                    err.kind(),
                    format!("Failed to get metadata for {path:?}: {err}"),
                )
            })?
            .is_dir()
        {
            inner(path, manifests)?;
            continue;
        }

        if path.extension() != Some("plist".as_ref()) {
            continue;
        }

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

    Ok(())
}
