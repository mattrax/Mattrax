package internal

import (
	"os"
)

// ProviderID is the unique ID used to identify the MDM server to the management client
// This is not shown to the user and should be globally identifying. It is required by some CSP's.
const ProviderID = "Mattrax"

// EnrollmentPolicyID is the unique ID of the MDM server's enrollment policy
const EnrollmentPolicyID = "mattrax-identity"

// EnrollmentPolicyFriendlyName is the friendly name of the server's enrollment policy
const EnrollmentPolicyFriendlyName = "Mattrax Identity Certificate Policy"

// ServerDisplayName is the name of the MDM server shown in Settings to the user
const ServerDisplayName = "Mattrax"

// CustomEnrollmentCompletePageTitle is the title of the page shown after the device is enrolled in management
const CustomEnrollmentCompletePageTitle = "Your Device Is Now Managed by Mattrax"

// CustomEnrollmentCompletePageBody is the body of the page shown after the device is enrolled in management
const CustomEnrollmentCompletePageBody = "Your device is now being managed by Mattrax."

// IndexWebsite the URL which is redirected when you go to this Microservice in your browser
const IndexWebsite = "https://mattrax.app"

// SupportWebsite is a websiite shown on the MDM client to the user
const SupportWebsite = "https://mattrax.app" // TODO: Mattrax support page

// EnrollmentPolicyServiceURL is the URL of the Enrollment Policy Service
var EnrollmentPolicyServiceURL = "https://" + os.Getenv("DOMAIN") + "/EnrollmentServer/Policy.svc"

// EnrollmentServiceURL is the URL of the Enrollment Service
var EnrollmentServiceURL = "https://" + os.Getenv("DOMAIN") + "/EnrollmentServer/Enrollment.svc"

// ManagementServiceURL is the URL of the Management Service
var ManagementServiceURL = "https://" + os.Getenv("MANAGEMENT_DOMAIN") + "/ManagementServer/Manage.svc"
