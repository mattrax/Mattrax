use std::borrow::Cow;

/// Statically bundles a file's content into the binary for production builds while loading it from the FS during development.
/// Returns [`Static`]
macro_rules! include_static {
    ($file:expr $(,)?) => {{
        $crate::utils::Static::new_from_static(
            concat!(env!("CARGO_MANIFEST_DIR"), "/static/", $file),
            include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/static/", $file)),
        )
    }};
}

pub(crate) use include_static;

/// A static value included from the filesystem.
/// In production this will be embedded into the binary and in development it will be read from the filesystem.
#[derive(Clone, Copy)]
#[allow(unused)]
pub struct Static {
    path: &'static str,
    value: &'static str,
}

impl Static {
    // You should use `include_static!` instead!
    #[doc(hidden)]
    pub const fn new_from_static(path: &'static str, value: &'static str) -> Self {
        Self { path, value }
    }

    pub fn derive<T: Clone>(&self, map: impl Fn(&str) -> T + Clone) -> impl Fn() -> T + Clone {
        #[cfg(debug_assertions)]
        {
            let path = self.path;
            move || map(&std::fs::read_to_string(path).expect("failed to `include_static!`"))
        }

        #[cfg(not(debug_assertions))]
        {
            let value = map(self.value);
            move || value.clone()
        }
    }

    pub fn get(&self) -> Cow<'static, str> {
        #[cfg(debug_assertions)]
        {
            Cow::Owned(std::fs::read_to_string(self.path).expect("failed to `include_static!`"))
        }

        #[cfg(not(debug_assertions))]
        {
            Cow::Borrowed(self.value)
        }
    }
}

impl axum::response::IntoResponse for Static {
    fn into_response(self) -> axum::response::Response {
        self.get().into_response()
    }
}
