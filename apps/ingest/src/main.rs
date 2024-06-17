mod apple_manifests;
mod windows_ddf;

fn main() {
    windows_ddf::generate_bindings();
    apple_manifests::generate_bindings();
}
