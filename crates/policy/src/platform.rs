/// TODO
pub enum Platform {
    Windows,
    MacOS,
    Ios,
    IPadOS,
    TvOS,
    WatchOS,
    Linux,
    Android,
    ChromeOS,
}

impl Platform {
    pub fn to_string(&self) -> &'static str {
        //     export type Platform =
        // | "macOS"
        // | "IOS"
        // | "iPadOS"
        // | "tvOS"
        // | "visionOS"
        // | "Windows"
        // | "Android"
        // | "Linux";
        todo!();
    }
}
