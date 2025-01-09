use std::env;
use std::process::Command;

fn main() {
    println!("cargo::rerun-if-changed=./lib");

    let status = Command::new("go")
        .args(&["build", "-o", "./out/mxgolang", "./lib/lib.go"])
        // TODOO: Configuration
        .env("CGO_ENABLED", "1")
        // .env("GOOS", "linux")
        // .env("GOARCH", "arm64")
        .current_dir(env::var("CARGO_MANIFEST_DIR").expect("missing 'CARGO_MANIFEST_DIR'"))
        .status()
        .expect("Failed to build `mxgolang` binary");
    if !status.success() {
        panic!("Failed to build `mxgolang` binary");
    }

    // return;

    // let target = env::var("TARGET").unwrap();

    // aarch64-unknown-linux-gnu

    // todo!("{:?}", target);

    // match "aarch64-unknown-linux-gnu"

    // CARGO_CFG_TARGET_ARCH

    // println!("{:?}", env::var("CARGO_MANIFEST_DIR"));

    // Command::new("go")
    //     .args(&[
    //         "build",
    //         "-buildmode=c-archive",
    //         "-o",
    //         "./out/libmxgolang2.a",
    //         "./lib/lib.go",
    //     ])
    //     // TODOO: Configuration
    //     // .env("CGO_ENABLED", "1")
    //     // .env("GOOS", "linux")
    //     // .env("GOARCH", "arm64")
    //     .current_dir(env::var("CARGO_MANIFEST_DIR").expect("missing 'CARGO_MANIFEST_DIR'"))
    //     .status()
    //     .expect("Failed to build libmxgolang.a");

    // Command::new("go")
    //     .args(&[
    //         "build",
    //         // "-tags=extended",
    //         // "-buildmode=c-archive",
    //         // "-o",
    //         // "./out/libmxgolang.a",
    //         "./lib/lib.go",
    //     ])
    //     // TODOO: Configuration
    //     .env("CGO_ENABLED", "1")
    //     .env("GOOS", "linux")
    //     .env("GOARCH", "arm64")
    //     .env("CC", "zig cc -target aarch64-linux")
    //     .env("CXX", "zig c++ -target aarch64-linux")
    //     .current_dir(env::var("CARGO_MANIFEST_DIR").expect("missing 'CARGO_MANIFEST_DIR'"))
    //     .status()
    //     .expect("Failed to build libmxgolang.a");
    // // todo!();

    // // println!("cargo:rustc-link-search=/Users/oscar/Desktop/Mattrax/crates/mx-golang/out");
    // // println!("cargo:rustc-link-lib=mxgolang");

    // let bindings = bindgen::Builder::default()
    //     .header("./out/libmxgolang2.h")
    //     .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
    //     .generate()
    //     .expect("Unable to generate bindings");

    // let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
    // bindings
    //     .write_to_file(out_path.join("bindings.rs"))
    //     .expect("Couldn't write bindings!");
}
