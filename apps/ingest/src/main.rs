mod windows_ddf;

use std::path::Path;

fn main() {
    let manifests = profile_manifests::parse_from_dir(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("./manifests"),
    )
    .unwrap();

    // TODO: Hook this up to the rest of the code
    // println!("{:#?}", manifests);

    windows_ddf::generate_bindings();
}
