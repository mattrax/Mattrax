//! TODO

mod encrypt;

pub use encrypt::encrypt;

fn main() {
    println!("A");

    encrypt(b"bruh", vec![()]).unwrap();
}
