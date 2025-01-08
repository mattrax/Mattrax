//! A standard cryptographic library for Mattrax.
//!
//! This library provides a standard easy to use interface across many cryptographic libraries.
//!
//! I found I had to combine multiple cryptographic libraries to get the functionality that was required.
//! This libraries hides that complexity and allows us to easily switch out the underlying libraries as they improve upstream.
//!
//! Long term it would be nice to unify the cryptographic libraries to:
//!  - Reduce build time by not including multiple implementations of the same features
//!  - Make cross-compiling easier by making the dependencies fully Rust
//!

pub mod cms;
pub mod x509;

// mod encrypt;
// pub use encrypt::encrypt;
