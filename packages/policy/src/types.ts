//! This file is generated by the 'export' unit test in 'mx-policy'! Do not modify it manually!

export type AppleConfigValue = number | string | boolean;
/**
 * Define the platforms that are supported by Mattrax.
 */
export type Platform =
	| "windows"
	| "macOS"
	| "iOS"
	| "iPadOS"
	| "tvOS"
	| "watchOS"
	| "linux"
	| "android"
	| "ChromeOS";
/**
 * TODO
 */
export type Policy = { id: string; name: string; data: PolicyData };
/**
 * TODO
 */
export type PolicyData = {
	/**
	 * SyncML nodes
	 */
	windows: { [key in string]: { [key in string]: WindowsConfigValue } };
	/**
	 * inner part of the `.mobileconfig`
	 */
	macos: { [key in string]: { [key in string]: AppleConfigValue }[] };
	/**
	 * Android configuration
	 */
	android: null;
	/**
	 * Linux configuration
	 */
	linux: null;
	/**
	 * Scripts
	 */
	scripts: Script[];
};
/**
 * TODO
 */
export type Script = {
	shell: Shell;
	supported?: Platform[];
	trigger?: Trigger;
	run: string;
};
/**
 * TODO
 */
export type Shell = "powershell" | "bash" | "zsh";
/**
 * TODO
 */
export type Trigger =
	/**
	 * Only run the script once. If you modify the script it will run again.
	 */
	| { type: "once" }
	/**
	 * Trigger anytime a user logs in
	 */
	| { type: "login" }
	/**
	 * Trigger anytime a user logs out
	 */
	| { type: "logout" }
	/**
	 * Trigger anytime a device starts up
	 */
	| { type: "startup" }
	/**
	 * Trigger anytime the network state changes
	 */
	| { type: "network_state_change" }
	/**
	 * Trigger after the device has been enrolled.
	 */
	| { type: "enrollment_complete" }
	/**
	 * Trigger every time the device talks with Mattrax.
	 */
	| { type: "checkin" };
export type WindowsConfigValue =
	| number
	| string
	| boolean
	| { [key: string]: Record<string, WindowsConfigValue> };
