//! Agent log: stderr (captured by launchd into the same file) plus a direct
//! append to `/var/log/mattraxd.log`. It records trigger decisions and exit
//! codes, never stdout/stderr or environment values.

use chrono::Utc;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

pub struct Logger {
    path: Option<PathBuf>,
}

impl Logger {
    pub fn system() -> Self {
        Self {
            path: Some(PathBuf::from(crate::LOG_PATH)),
        }
    }

    pub fn to_path(path: impl Into<PathBuf>) -> Self {
        Self {
            path: Some(path.into()),
        }
    }

    /// Tests and `--check` style output use a logger that only writes stderr.
    pub fn stderr_only() -> Self {
        Self { path: None }
    }

    pub fn log(&self, message: impl AsRef<str>) {
        let line = format!(
            "[{}] {}\n",
            Utc::now().format("%Y-%m-%dT%H:%M:%SZ"),
            message.as_ref()
        );

        eprint!("{line}");

        if let Some(path) = &self.path {
            // A logging failure must never stop the daemon; launchd's stderr
            // redirect still has the line.
            let _ = OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .and_then(|mut file| file.write_all(line.as_bytes()));
        }
    }
}
