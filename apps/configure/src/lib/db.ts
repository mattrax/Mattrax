import { makeEventListener } from "@solid-primitives/event-listener";
import { createQuery } from "@tanstack/solid-query";
import { type DBSchema, type StoreKey, type StoreNames, openDB } from "idb";
import type { Filter } from "~/components/search/filters";

export type TableName =
	| "users"
	| "devices"
	| "groups"
	| "policies"
	| "scripts"
	| "apps";

export interface Database extends DBSchema {
	// Used to store general information
	_kv: {
		key:
			| "user"
			| "accessToken"
			| "refreshToken"
			| "configurationSettings"
			| "configurationCategories";
		value: string;
	};
	// Track the nextPage links for each active paginated query and keep track of delta links ready for the next sync.
	_meta: {
		key: TableName;
		value:
			| {
					count: number;
					offset: number;
					nextPage: string;
			  }
			| {
					// not all tables we sync support delta links
					deltaLink?: string;
					syncedAt: Date;
			  };
	};
	// Stored views
	views: {
		key: string;
		value: {
			id: string;
			name: string;
			description?: string;
			data: Filter[];
		};
	};
	// Entities from Microsoft
	users: {
		key: string;
		value: {
			id: string;
			type: "member" | "guest";
			upn: string;
			name: string;
			nameParts: {
				givenName?: string;
				surname?: string;
			};
			accountEnabled: boolean;
			employeeId?: string;
			officeLocation?: string;
			phones: string[];
			preferredLanguage?: string;
			lastPasswordChangeDateTime?: string;
			createdDateTime: string; // TODO: As `Date`
			// TODO: Maybe information of user sync source to disable mutations when not supported???
		};
	};
	devices: {
		key: string;
		value: {
			id: string;
			deviceId: string;
			name: string;
			deviceOwnership: "unknown" | "company" | "personal";
			type: "RegisteredDevice" | "SecureVM" | "Printer" | "Shared" | "IoT";
			trustType: "Workplace" | "AzureAd" | "ServerAd" | "unknown";
			enrollment: {
				profileName?: string;
				type:
					| "unknown"
					| "userEnrollment"
					| "deviceEnrollmentManager"
					| "appleBulkWithUser"
					| "appleBulkWithoutUser"
					| "windowsAzureADJoin"
					| "windowsBulkUserless"
					| "windowsAutoEnrollment"
					| "windowsBulkAzureDomainJoin"
					| "windowsCoManagement";
			};
			isCompliant?: boolean;
			isManaged: boolean;
			isRooted: boolean;
			managementType:
				| "eas"
				| "mdm"
				| "easMdm"
				| "intuneClient"
				| "easIntuneClient"
				| "configurationManagerClient"
				| "configurationManagerClientMdm"
				| "configurationManagerClientMdmEas"
				| "unknown"
				| "jamf"
				| "googleCloudDevicePolicyController";
			manufacturer?: string;
			model?: string;
			operatingSystem?: string;
			operatingSystemVersion?: string;
			// TODO: `serialNumber`???
			// TODO: Primary user UPN
			// TODO: Last checkedin time???
			lastSignInDate?: string; // TODO: As `Date`
			registrationDateTime?: string; // TODO: As `Date`
			deviceCategory?: string;
		};
	};
	groups: {
		key: string;
		value: {
			id: string;
			name: string;
			description?: string;
			securityEnabled: boolean;
			visibility?: "Private" | "Public" | "HiddenMembership";
			// TODO: Can't be `$select`ed
			// isArchived: boolean;
			// TODO: How do you configure this in UI??? I checked Azure and Office 365
			// theme?: "Teal" | "Purple" | "Green" | "Blue" | "Pink" | "Orange" | "Red";
			createdDateTime: string; // TODO: As `Date`
		};
	};
	groupMembers: {
		key: string;
		value: {
			groupId: string;
			type:
				| "#microsoft.graph.user"
				| "#microsoft.graph.group"
				| "#microsoft.graph.device";
			id: string;
		};
	};
	policies: {
		key: string;
		value: {
			id: string;
			name: string;
			description?: string;
			createdDateTime: string; // TODO: As `Date`
			lastModifiedDateTime: string; // TODO: As `Date`
		} & (
			| {
					platforms?:
						| "none"
						| "android"
						| "iOS"
						| "macOS"
						| "windows10X"
						| "windows10"
						| "linux"
						| "unknownFutureValue";
					technologies?:
						| "none"
						| "mdm"
						| "windows10XManagement"
						| "configManager"
						| "appleRemoteManagement"
						| "microsoftSense"
						| "exchangeOnline"
						| "mobileApplicationManagement"
						| "linuxMdm"
						| "extensibility"
						| "enrollment"
						| "endpointPrivilegeManagement"
						| "unknownFutureValue"
						| "windowsOsRecovery";
					settings: {
						id: string;
						settingInstance: any; // TODO: Typescript
					}[];
			  }
			| {
					"@odata.type":
						| "#microsoft.graph.iosCustomConfiguration"
						| "#microsoft.graph.windows10CustomConfiguration"
						| "#microsoft.graph.windows10GeneralConfiguration"
						| "#microsoft.graph.windowsWifiConfiguration"
						| string; // TODO: Find all of them
					version: number;
			  }
		);
	};
	policiesAssignments: {
		key: string;
		value: {
			policyId: string;
			type:
				| "#microsoft.graph.user"
				| "#microsoft.graph.group"
				| "#microsoft.graph.device";
			id: string;
		};
	};
	scripts: {
		key: string;
		value: {
			id: string;
			name: string;

			scriptContent: string;
			fileName: string;
			runAsAccount: "system" | "user";

			createdDateTime: string; // TODO: As `Date`
			lastModifiedDateTime: string; // TODO: As `Date`
		} & ( // Powershell
			| {
					enforceSignatureCheck: boolean;
					runAs32Bit: boolean;
			  }
			// Bash
			| {
					executionFrequency: any; // TODO: Type
					retryCount: number;
					blockExecutionNotifications: boolean;
			  }
		);
	};
	scriptAssignments: {
		key: string;
		value: {
			policyId: string;
			type:
				| "#microsoft.graph.user"
				| "#microsoft.graph.group"
				| "#microsoft.graph.device";
			id: string;
		};
	};
	apps: {
		key: string;
		value: {
			id: string;
			type:
				| "#microsoft.graph.iosStoreApp"
				| "#microsoft.graph.managedIOSStoreApp"
				| "#microsoft.graph.managedAndroidStoreApp"
				| "#microsoft.graph.winGetApp"
				| string; // TODO: Find all of them
			name: string;
			description?: string;
			publisher?: string;
			largeIcon?: any; // TODO: types
			createdDateTime: string; // TODO: As `Date`
			lastModifiedDateTime: string; // TODO: As `Date`
			isFeatured: boolean;
			privacyInformationUrl?: string;
			informationUrl?: string;
			owner?: string;
			developer?: string;
			notes?: string;
		};
	};
	appAssignments: {
		key: string;
		value: {
			policyId: string;
			type:
				| "#microsoft.graph.user"
				| "#microsoft.graph.group"
				| "#microsoft.graph.device";
			id: string;
		};
	};
}

export const db = openDB<Database>("data", 1, {
	upgrade(db) {
		db.createObjectStore("_kv");
		db.createObjectStore("_meta");
		db.createObjectStore("views", {
			keyPath: "id",
		});
		db.createObjectStore("users", {
			keyPath: "id",
		});
		db.createObjectStore("devices", {
			keyPath: "id",
		});
		db.createObjectStore("groups", {
			keyPath: "id",
		});
		db.createObjectStore("groupMembers", {
			keyPath: ["groupId", "type", "id"],
		});
		db.createObjectStore("policies", {
			keyPath: "id",
		});
		db.createObjectStore("policiesAssignments", {
			keyPath: ["groupId", "type", "id"],
		});
		db.createObjectStore("scripts", {
			keyPath: "id",
		});
		db.createObjectStore("scriptAssignments", {
			keyPath: ["groupId", "type", "id"],
		});
		db.createObjectStore("apps", {
			keyPath: "id",
		});
		db.createObjectStore("appAssignments", {
			keyPath: ["groupId", "type", "id"],
		});
	},
	terminated() {
		// TODO: Warning & disable all UI state???
	},
});

const syncBroadcastChannel = new BroadcastChannel("sync");

type InvalidationKey =
	| StoreNames<Database>
	| "auth"
	| "isSyncing"
	| "syncProgress";

// Subscribe to store invalidations to trigger queries to rerun of the data
export function subscribeToInvalidations(
	onChange: (store: InvalidationKey) => void,
) {
	const onChangeInner = (data: any) => {
		if (typeof data === "string") onChange(data as any);
		else if (typeof data === "object" && Array.isArray(data)) {
			for (const store of data) {
				onChange(store);
			}
		} else {
			console.error(
				`subscribeToInvalidations: got invalid type '${typeof data}'`,
			);
		}
	};

	makeEventListener(syncBroadcastChannel, "message", (event) => {
		if (event.origin !== window.origin) return;
		onChangeInner(event.data);
	});
	makeEventListener(document, "#sync", (event) =>
		onChangeInner((event as any).detail),
	);
}

// This will invalidate a store, triggering all queries against it to rerun updating the UI.
export function invalidateStore(
	storeName: InvalidationKey | InvalidationKey[],
) {
	syncBroadcastChannel.postMessage(storeName);
	document.dispatchEvent(new CustomEvent("#sync", { detail: storeName }));
}

// Construct a reactive IndexedDB query for usage within SolidJS.
export function createIdbQuery<Name extends StoreNames<Database>>(
	storeName: Name,
	query?: StoreKey<Database, Name> | IDBKeyRange | null,
	count?: number,
) {
	const data = createQuery(() => ({
		queryKey: [storeName, query, count],
		queryFn: async () => await (await db).getAll(storeName, query, count),
	}));

	subscribeToInvalidations((store) => {
		if (store === storeName) data.refetch();
	});

	return data;
}
