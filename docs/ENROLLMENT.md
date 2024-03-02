A quick runtime of enrollment flows. Turn this into a docs page for users/contributors.

## Browser initiated

1. User visits `https://cloud.mattrax.app/enroll`
2. User enters email
3. User is sent to identity provider
4. User is presented with a button corresponding to the OS of the device then the flow splits.

### Windows

We use an `ms-device-enrollment` deep link to begin the enrollment process.

We include an `accesstoken` query parameter. When the MDM webview renders `/api/enrollment/login` it will forward this `accesstoken` query parameter, which will cause the MDM callback form to be rendered immediately, skipping the OAuth flow.

### macOS/IOS/iPadOS

We download a `.mobileconfig` file which the user must open to install, and then navigate to Settings to approve the profile.

### Android

¯\_(ツ)_/¯ 

### Linux

¯\_(ツ)_/¯ 

## User-initiated Windows

### Using EntraID

Requires paid subscription - TODO Document.

 - The users goes to "Access work and school" on their device.
 - They enter their email.
 - Microsoft notices an EntraID tenant exists.
 - It pulls the MDM configuration from the "MDM & Mobility" tab in the EntraID portal.
 - The `/tos.html` page is rendered in the MDM webview (currently we auto-accept the TOS without interaction but in future we will have UI flow here).
 - The device sends a Microsoft JWT to the MDM server for the enrollment process which we can use to correlate the Mattrax user.

### Not using EntraID

 - The user goes to "Access work and school" on their device.
 - They enter their email.
 - The device does a require to `https://enterpriseenrollment.{domain}/EnrollmentServer/Discovery.svc` to find the MDM server.
 - The MDM webview renders `/api/enrollment/login` and the user is prompted to login using their authentication provider.
 - The MDM callback form is rendered with the auth token.

## User-initiated macOS/IOS/iPadOS

¯\_(ツ)_/¯ - This requires Apple Business Manager or Apple School Manager is all I know.

## User-initiated Android

¯\_(ツ)_/¯