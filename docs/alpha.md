# Alpha

The following is a list of features that are expected to land prior to us going out of alpha.

 - [ ] Proper licence key system
 - [ ] Input validation
 - [ ] Overhaul authentication sessions
  - [ ] Email validation + API for chaning it
  - [ ] If the user record isn't found (Eg. `/me`) we should instantly log the user out
  - [ ] Access tokens for CLI
  - [ ] Track where the token is used and when it was used
  - [ ] Allow revoking any specific token
  - [ ] Refresh tokens in the browser so the user doesn't keep having to log in
 - [ ] Tenant user management
  - [ ] Invite/uninvite users
  - [ ] Permissions?
 - [ ] Enrollment v2
  - [ ] Restrict who can enroll, how many devices, the default group, etc.
  - [ ] How does this tie inot Windows Autopilot/Apple DEP???
 - [ ] Public API
  - [ ] CORS without leaking out cookies
  - [ ] Linking docs publically
 - [ ] Proper response body with error categories (Eg. DB, logic, etc)

Apple management:
 - [ ] Codesign profiles
 - [ ] Encrypt enrollment profiles

Technical debt:
 - [ ] Automatic OpenAPI schema
 - [ ] Serve the frontend via a CDN
