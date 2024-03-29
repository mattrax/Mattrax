//! This file is generated by the 'export' unit test in 'mattrax-policy'! Do not modify it manually!

/**
 * TODO
 */
export type Policy = {
	id: string;
	name: string;
	description?: string | null;
	configurations?: Configuration[];
};

/**
 * TODO
 */
export type Configuration =
	/**
	 * TODO
	 */
	| { type: "windows_custom"; oma_uri: string; value: string }
	/**
	 * TODO
	 */
	| { type: "apple_custom"; path: string }
	| { type: "script"; run: string }
	/**
	 * TODO
	 */
	| { type: "wi_fi" }
	/**
	 * TODO
	 */
	| { type: "chromium" }
	/**
	 * TODO
	 */
	| { type: "edge" }
	/**
	 * TODO
	 */
	| { type: "brave" }
	/**
	 * Configuration for Slack desktop app.
	 * Reference: https://slack.com/intl/en-au/help/articles/11906214948755-Manage-desktop-app-configurations
	 */
	| { type: "slack"; auto_update: boolean | null };
