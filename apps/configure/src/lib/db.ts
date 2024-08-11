import type { DBSchema, StoreNames as IDBPStoreNames } from "idb";
import { type IDBPDatabaseExt, openDB } from "idbp";
import type { Filter } from "~/components/search/filters";
import type { SyncOperation } from "./sync/operation";

export type TableName =
	| "users"
	| "devices"
	| "groups"
	| "policies"
	| "scripts"
	| "apps";

export type Database = IDBPDatabaseExt<DbTypes>;
export type StoreNames = IDBPStoreNames<DbTypes>;
export type InferStoreKey<T extends keyof DbTypes> = DbTypes[T]["value"];
export type InferStoreValue<T extends keyof DbTypes> = DbTypes[T]["value"];

export interface DbTypes extends DBSchema {
	// Used to store general information
	_kv: {
		key: string;
		value: any;
	};
	// Track the nextPage links for each active paginated query and keep track of delta links ready for the next sync.
	// This table should be interfaced with through `defineSyncOperation` to ensure you do it correctly.
	_meta: {
		key: SyncOperation;
		value:
			| {
					// Idle
					syncedAt: Date;
					meta: any;
			  }
			| {
					// Syncing
					syncId: string;
					completed: number;
					total: number;
					meta?: any;
			  };
	};
	// Queued mutations
	_mutations: {
		key: string;
		value: {
			id: string;
			type: string;
			applied: boolean;
			data: any;
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
			_syncId: string;
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
			_syncId: string;
			id: string;
			deviceId: string;
			name: string;
			deviceOwnership: "unknown" | "company" | "personal";
			type?: "RegisteredDevice" | "SecureVM" | "Printer" | "Shared" | "IoT";
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
					| "windowsCoManagement"

					// This isn't in the docs but it is in the data so...
					// TODO: Maybe check OpenAPI docs if we can discover more values they aren't telling us about?
					| "AzureDomainJoined"
					| "DeviceEnrollment";
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
			_syncId: string;
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
			_syncId: string;
			groupId: string;
			type:
				| "#microsoft.graph.user"
				| "#microsoft.graph.group"
				| "#microsoft.graph.device"
				| "#microsoft.graph.servicePrincipal";
			id: string;
		};
	};
	policies: {
		key: string;
		value: {
			_syncId: string;
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
			_syncId: string;
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
			_syncId: string;
			id: string;
			name: string;
			description?: string;
			scriptContent?: string;
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
					executionFrequency: string;
					retryCount: number;
					blockExecutionNotifications: boolean;
			  }
		);
	};
	scriptAssignments: {
		key: string;
		value: {
			_syncId: string;
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
			_syncId: string;
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
			_syncId: string;
			policyId: string;
			type:
				| "#microsoft.graph.user"
				| "#microsoft.graph.group"
				| "#microsoft.graph.device";
			id: string;
		};
	};
}

export const dbVersion = 1;

export const openAndInitDb = (name: string, createIfNotFound = false) =>
	openDB<DbTypes>(name, dbVersion, {
		upgrade(db, oldVersion, newVersion, tx) {
			// Aborting causes the DB creation to fail (in only Chrome *sigh*)
			if (oldVersion === 0 && !createIfNotFound) {
				if ("chrome" in window) return tx.abort();
				db.close();
				window.indexedDB.deleteDatabase(name);
				return;
			}

			db.createObjectStore("_kv");
			db.createObjectStore("_meta");
			db.createObjectStore("_mutations", {
				keyPath: "id",
			});
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
		blocking(currentVersion, blockedVersion, event) {
			// TODO
		},
		blocked(currentVersion, blockedVersion, event) {
			console.log(currentVersion, blockedVersion, event);
			// TODO: Handle this???
		},
		terminated() {
			// TODO: Warning & disable all UI state???
		},
	});
