-- DO NOT RUN THIS FILE. It is used along with sqlc to generate type safe Go from SQL

-- name: GetUserCount :one
SELECT COUNT(*) FROM users;

-------- Tenant

-- name: GetTenant :one
SELECT display_name, primary_domain, email, phone, afw_enterprise_id FROM tenants WHERE id = $1 LIMIT 1;

-- name: GetTenantDomains :many
SELECT domain, linking_code, verified FROM tenant_domains WHERE tenant_id = $1;

-- name: GetTenantDomain :one
SELECT linking_code, verified FROM tenant_domains WHERE domain=$1 AND tenant_id=$2 LIMIT 1;

-- name: AddDomainToTenant :one
INSERT INTO tenant_domains(tenant_id, domain) VALUES ($1, $2) RETURNING linking_code;

-- name: UpdateDomain :exec
UPDATE tenant_domains SET verified=$3 WHERE domain=$1 AND tenant_id=$2;

-- name: DeleteDomain :exec
DELETE FROM tenant_domains WHERE domain=$1 AND tenant_id=$2;

-- name: UpdateTenant :exec
UPDATE tenants SET display_name=COALESCE($2, display_name), email=COALESCE($3, email), phone=COALESCE($4, phone) WHERE id=$1;

-------- User

-- name: NewUser :exec
INSERT INTO users(upn, fullname, password, tenant_id) VALUES ($1, $2, $3, $4);

-- name: NewGlobalUser :exec
INSERT INTO users(upn, fullname, password, password_expiry) VALUES ($1, $2, $3, $4);

-- name: GetUser :one
SELECT upn, fullname, disabled, azuread_oid FROM users WHERE upn = $1 LIMIT 1;

-- name: GetUsersInTenant :many
SELECT upn, fullname, azuread_oid FROM users WHERE tenant_id = $1 LIMIT $2 OFFSET $3;
-- Once https://github.com/kyleconroy/sqlc/issues/778 is fixed change query to (including the ByQuery one): SELECT upn, fullname, azuread_oid FROM users INNER JOIN tenant_users ON users.upn = tenant_users.user_upn WHERE tenant_users.tenant_id = $1 UNION ALL SELECT upn, fullname, azuread_oid FROM users WHERE tenant_id = $1;

-- name: GetUsersInTenantByQuery :many
SELECT upn, fullname, azuread_oid FROM users WHERE tenant_id = $1 AND (upn || fullname || azuread_oid) LIKE $4 LIMIT $2 OFFSET $3;

-- name: GetUserSecure :one
SELECT fullname, disabled, password, password_expiry, mfa_token, tenant_id FROM users WHERE upn = $1 LIMIT 1;

-- name: UpdateUser :exec
UPDATE users SET fullname=COALESCE($2, fullname), password=COALESCE($3, password), password_expiry=COALESCE($4, password_expiry) WHERE upn=$1;

-- name: UpdateUserInTenant :one
UPDATE users SET fullname=COALESCE($3, fullname), disabled=COALESCE($4, disabled), password=COALESCE($5, password) WHERE upn=$1 AND tenant_id=$2 RETURNING upn;

-- name: DeleteUser :exec
DELETE FROM users WHERE upn=$1;

-- name: DeleteUserInTenant :exec
DELETE FROM users WHERE upn=$1 AND tenant_id=$2;

-- name: NewUserFromAzureAD :exec
INSERT INTO users(upn, fullname, azuread_oid) VALUES ($1, $2, $3);

-- name: NewTenant :one
INSERT INTO tenants(display_name, primary_domain) VALUES ($1, $2) RETURNING id;

-- name: ScopeUserToTenant :exec
INSERT INTO tenant_users(user_upn, tenant_id, permission_level) VALUES ($1, $2, $3);

-- name: GetUserPermissionLevelForTenant :one
SELECT permission_level FROM tenant_users WHERE user_upn = $1 AND tenant_id = $2;

-- name: GetUserTenants :many
SELECT id, display_name, primary_domain, description FROM tenants INNER JOIN tenant_users ON tenants.id = tenant_users.tenant_id WHERE tenant_users.user_upn = $1;

-- name: RemoveUserFromTenant :exec
DELETE FROM tenant_users WHERE user_upn=$1 AND tenant_id=$2;

-------- Object Actions

-- name: GetObject :one
SELECT filename, data FROM objects WHERE id = $1 AND tenant_id = $2 LIMIT 1;

-- name: CreateObject :exec
INSERT INTO objects(tenant_id, filename, data) VALUES ($1, $2, $3) RETURNING id;

-- name: UpdateObject :exec
UPDATE objects SET filename=$3, data=$4 WHERE id=$1 AND tenant_id=$2;

-------- Group Actions

-- name: NewGroup :one
INSERT INTO groups(name, tenant_id) VALUES ($1, $2) RETURNING id;

-- name: GetGroups :many
SELECT id, name, description FROM groups WHERE tenant_id = $1 LIMIT $2 OFFSET $3;

-- name: GetGroup :one
SELECT id, name, description FROM groups WHERE id = $1 AND tenant_id = $2 LIMIT 1;

-- name: DeleteGroup :exec
DELETE FROM groups WHERE id = $1 AND tenant_id = $2;

-- name: GetDevicesInGroup :many
SELECT devices.id, devices.name FROM group_devices INNER JOIN devices ON devices.id=group_devices.device_id WHERE group_id = $1 AND tenant_id = $2 LIMIT $3 OFFSET $4;

-- name: AddDeviceToGroup :exec
INSERT INTO group_devices(group_id, device_id) VALUES ($1, $2);

-- name: RemoveDeviceFromGroup :exec
DELETE FROM group_devices WHERE group_id = $1 AND device_id = $2;

-- name: GetPoliciesInGroup :many
SELECT policies.id, policies.name FROM group_policies INNER JOIN policies ON policies.id=group_policies.policy_id WHERE group_id = $1 AND tenant_id = $2 LIMIT $3 OFFSET $4;

-- name: AddPolicyToGroup :exec
INSERT INTO group_policies(group_id, policy_id) VALUES ($1, $2);

-- name: RemovePolicyFromGroup :exec
DELETE FROM group_policies WHERE group_id = $1 AND policy_id = $2;

-- name: UpdateGroup :exec
UPDATE groups SET name=COALESCE($3, name) WHERE id=$1 AND tenant_id=$2;

-------- Policy Actions

-- name: NewPolicy :one
INSERT INTO policies(name, type, tenant_id) VALUES ($1, $2, $3) RETURNING id;

-- name: GetPolicies :many
SELECT id, name, type, description FROM policies WHERE tenant_id = $1 LIMIT $2 OFFSET $3;

-- name: GetPolicy :one
SELECT name, type, payload, description FROM policies WHERE id = $1 AND tenant_id = $2 LIMIT 1;

-- name: GetPolicyGroups :many
SELECT groups.id, groups.name FROM groups INNER JOIN group_policies ON group_policies.group_id=groups.id WHERE group_policies.policy_id = $1 AND groups.tenant_id = $2;

-- name: GetDevicesWithPolicy :many
SELECT DISTINCT device_id FROM group_devices INNER JOIN group_policies ON group_policies.group_id=group_devices.group_id WHERE group_policies.policy_id = $1;

-- name: UpdatePolicy :exec
UPDATE policies SET name=COALESCE($3, name), payload=payload||$4 WHERE id=$1 AND tenant_id=$2;

-- name: DeletePolicy :exec
DELETE FROM policies WHERE id = $1 AND tenant_id = $2;

-------- Application Actions

-- name: NewApplication :one
INSERT INTO applications(name, tenant_id) VALUES ($1, $2) RETURNING id;

-- name: GetApplications :many
SELECT id, name, publisher FROM applications WHERE tenant_id = $1 LIMIT $2 OFFSET $3;

-- name: GetApplication :one
SELECT name, description, publisher FROM applications WHERE id = $1 AND tenant_id = $2 LIMIT 1;

-- name: GetApplicationTargets :many
SELECT msi_file, store_id FROM application_target WHERE app_id = $1 AND tenant_id = $2;

-- name: UpdateApplication :exec
UPDATE applications SET name=COALESCE($3, name), description=COALESCE($4, description), publisher=COALESCE($5, publisher) WHERE id = $1 AND tenant_id=$2;

-- name: DeleteApplication :exec
DELETE FROM applications WHERE id = $1 AND tenant_id = $2;

-------- Device Actions

-- name: CreateDevice :one
INSERT INTO devices(tenant_id, protocol, scope, state, udid, name, serial_number, model_manufacturer, model, os_major, os_minor, owner, ownership, azure_did) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id;

-- name: GetDeviceForManagement :one
SELECT id, tenant_id, protocol, scope, state, name, serial_number, model_manufacturer, model, os_major, os_minor, owner, ownership, azure_did FROM devices WHERE udid = $1 LIMIT 1;

-- name: GetDevices :many
SELECT id, protocol, name, model FROM devices WHERE tenant_id = $1 LIMIT $2 OFFSET $3;

-- name: GetDevice :one
SELECT id, protocol, scope, state, name, serial_number, model_manufacturer, model, os_major, os_minor, owner, ownership, azure_did, enrolled_at, lastseen FROM devices WHERE id = $1 AND tenant_id = $2 LIMIT 1;

-- name: GetDeviceGroups :many
SELECT groups.id, groups.name FROM groups INNER JOIN group_devices ON group_devices.group_id=groups.id WHERE group_devices.device_id = $1 AND groups.tenant_id = $2;

-- name: GetDevicePolicies :many
SELECT DISTINCT ON (id) id, name, description, policy_id, group_devices.group_id FROM policies INNER JOIN group_policies ON group_policies.policy_id = policies.id INNER JOIN group_devices ON group_devices.group_id=group_policies.group_id WHERE group_devices.device_id = $1;

-- name: UpdateDevice :exec
UPDATE devices SET name=COALESCE($3, name) WHERE id = $1 AND tenant_id=$2;

-------- Certificates

-- name: GetRawCert :one
SELECT cert, key FROM certificates WHERE id = $1 LIMIT 1;

-- name: CreateRawCert :exec
INSERT INTO certificates(id, cert, key) VALUES ($1, $2, $3);

-------- Android For Work Enrollment State

-- name: AFWGetAndRemoveState :one
DELETE FROM android_for_work_enrollment_state WHERE id=$1 RETURNING name;

-- name: AFWCreateState :one
INSERT INTO android_for_work_enrollment_state(name) VALUES (NULL) RETURNING id;

-- name: AFWUpdateState :exec
UPDATE android_for_work_enrollment_state SET name=$2 WHERE id=$1;

-- name: AFWUpdateTenant :exec
UPDATE tenants SET afw_enterprise_id=$2 WHERE id=$1;