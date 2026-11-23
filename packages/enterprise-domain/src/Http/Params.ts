import { AppleUserActionName } from "../deviceActions.js";
import { Schema } from "effect";

export { AppleUserActionName };

export const IdParam = { id: Schema.String };

export const TenantParam = { tenantId: Schema.String };

export const TenantIdParam = { tenantId: Schema.String, id: Schema.String };

export const TenantInvitationParam = { tenantId: Schema.String, invitationId: Schema.String };

export const TenantAccountParam = { tenantId: Schema.String, accountId: Schema.String };

export const TenantUserParam = { tenantId: Schema.String, userId: Schema.String };

export const TenantPreRegistrationParam = { tenantId: Schema.String, id: Schema.String };

/** A user channel is addressed by the device plus Apple's opaque user id. */
export const TenantDeviceUserParam = {
  tenantId: Schema.String,
  id: Schema.String,
  userId: Schema.String,
};

export const TenantAttributeParam = { tenantId: Schema.String, attributeId: Schema.String };

/** One attribute's value on one device (device id is `:id`). */
export const TenantDeviceAttributeParam = {
  tenantId: Schema.String,
  id: Schema.String,
  attributeId: Schema.String,
};

export const TenantWebhookParam = { tenantId: Schema.String, webhookId: Schema.String };

export const TenantWebhookDeliveryParam = {
  tenantId: Schema.String,
  webhookId: Schema.String,
  deliveryId: Schema.String,
};

export const TenantAutopilotDeviceParam = { tenantId: Schema.String, serial: Schema.String };

export const TenantAutopilotProfileParam = { tenantId: Schema.String, profileId: Schema.String };

export const TenantMigrationParam = { tenantId: Schema.String, migrationId: Schema.String };

export const TenantMigrationEntryParam = {
  tenantId: Schema.String,
  migrationId: Schema.String,
  entryId: Schema.String,
};

export const TenantDeviceViewParam = { tenantId: Schema.String, viewId: Schema.String };

export const TenantDashboardParam = { tenantId: Schema.String, dashboardId: Schema.String };

export const TenantDashboardWidgetParam = {
  tenantId: Schema.String,
  dashboardId: Schema.String,
  widgetId: Schema.String,
};

export const TenantDashboardReportParam = {
  tenantId: Schema.String,
  dashboardId: Schema.String,
  reportId: Schema.String,
};

export const TenantRoleParam = { tenantId: Schema.String, roleId: Schema.String };

export const McpConnectionParam = { connectionId: Schema.String };

export const ApiTokenParam = { tokenId: Schema.String };
