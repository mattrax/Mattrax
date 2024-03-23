use std::{borrow::Cow, io, path::PathBuf};

use specta::ts::{comments, CommentFormatterFn};

use crate::DeprecatedType;

#[derive(Debug)]
#[non_exhaustive]
pub struct CommentFormatterArgs<'a> {
    pub docs: &'a Cow<'static, str>,
    pub deprecated: Option<&'a DeprecatedType>,
}

/// The signature for a function responsible for exporting Typescript comments.
// pub type CommentFormatterFn = fn(CommentFormatterArgs) -> String; // TODO: Returning `Cow`???

/// The signature for a function responsible for formatter a Typescript file.
pub type FormatterFn = fn(PathBuf) -> io::Result<()>;

/// Options for controlling the behavior of the Typescript exporter.
#[derive(Debug, Clone)]
pub struct ExportConfig {
    /// How BigInts should be exported.
    pub(crate) bigint: BigIntExportBehavior,
    /// How comments should be rendered.
    pub(crate) comment_exporter: Option<CommentFormatterFn>,
    /// How the resulting file should be formatted.
    pub(crate) formatter: Option<FormatterFn>,
}

impl ExportConfig {
    /// Construct a new `ExportConfiguration`
    pub fn new() -> Self {
        Default::default()
    }

    /// Configure the BigInt handling behaviour
    pub fn bigint(mut self, bigint: BigIntExportBehavior) -> Self {
        self.bigint = bigint;
        self
    }

    /// Configure a function which is responsible for styling the comments to be exported
    ///
    /// Implementations:
    ///  - [`js_doc`](crate::lang::ts::js_doc)
    ///
    /// Not calling this method will default to the [`js_doc`](crate::lang::ts::js_doc) exporter.
    /// `None` will disable comment exporting.
    /// `Some(exporter)` will enable comment exporting using the provided exporter.
    pub fn comment_style(mut self, exporter: Option<CommentFormatterFn>) -> Self {
        self.comment_exporter = exporter;
        self
    }

    /// Configure a function which is responsible for formatting the result file or files
    ///
    ///
    /// Implementations:
    ///  - [`prettier`](crate::lang::ts::prettier)
    ///  - [`ESLint`](crate::lang::ts::eslint)
    pub fn formatter(mut self, formatter: FormatterFn) -> Self {
        self.formatter = Some(formatter);
        self
    }

    /// Run the specified formatter on the given path.
    pub fn run_format(&self, path: PathBuf) -> io::Result<()> {
        if let Some(formatter) = self.formatter {
            formatter(path)?;
        }
        Ok(())
    }
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            bigint: Default::default(),
            comment_exporter: Some(comments::js_doc),
            formatter: None,
        }
    }
}

/// Allows you to configure how Specta's Typescript exporter will deal with BigInt types ([i64], [i128] etc).
///
/// WARNING: None of these settings affect how your data is actually ser/deserialized.
/// It's up to you to adjust your ser/deserialize settings.
#[derive(Debug, Clone, Default)]
pub enum BigIntExportBehavior {
    /// Export BigInt as a Typescript `string`
    ///
    /// Doing this is serde is [pretty simple](https://github.com/serde-rs/json/issues/329#issuecomment-305608405).
    String,
    /// Export BigInt as a Typescript `number`.
    ///
    /// WARNING: `JSON.parse` in JS will truncate your number resulting in data loss so ensure your deserializer supports large numbers.
    Number,
    /// Export BigInt as a Typescript `BigInt`.
    BigInt,
    /// Abort the export with an error.
    ///
    /// This is the default behavior because without integration from your serializer and deserializer we can't guarantee data loss won't occur.
    #[default]
    Fail,
    /// Same as `Self::Fail` but it allows a library to configure the message shown to the end user.
    #[doc(hidden)]
    FailWithReason(&'static str),
}
