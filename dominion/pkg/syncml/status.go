package syncml

const (
	// StatusOK - The SyncML command completed successfully.
	StatusOK = 200
	// StatusCommandFailed - Command failed. Generic failure. The recipient encountered an unexpected condition which prevented it from fulfilling the request. This response code will occur when the SyncML DPU cannot map the originating error code.
	StatusCommandFailed = 500
	// StatusBadRequest - Error caused by client.
	StatusBadRequest = 400
	// StatusUnauthorized - Invalid credentials. The requested command failed because the requestor must provide proper authentication. CSPs do not usually generate this error.
	StatusUnauthorized = 401
	// StatusForbidden - Forbidden. The requested command failed, but the recipient understood the requested command.
	StatusForbidden = 403
)

const (
	// GenericAlert is reported when the user triggers unenrollment or when the CSP finishes an asynchronous action
	GenericAlert = "1226"
	// DeviceAlert is used when the device triggered the event
	DeviceAlert = "1224"
)
