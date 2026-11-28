import { Schema } from "effect";

import { newId } from "./crypto.js";

/**
 * Nominal identifiers. Each kind owns a prefix and an Effect Schema that
 * validates it, so one entity's id cannot be passed as another's.
 * Path segments stay unprefixed: the route segment already declares the kind,
 * so handlers use `fromParam` to brand it at the boundary.
 */
export const TenantIdSchema = Schema.TemplateLiteral(["tn_", Schema.String]).pipe(Schema.brand("TenantId"));
export type TenantId = typeof TenantIdSchema.Type;
export const TenantId = {
  prefix: "tn_" as const,
  schema: TenantIdSchema,
  make: (): TenantId => `tn_${newId()}` as TenantId,
  fromParam: (value: string): TenantId => value as TenantId,
  is: (value: unknown): value is TenantId => Schema.is(TenantIdSchema)(value),
};

export const AccountIdSchema = Schema.TemplateLiteral(["ac_", Schema.String]).pipe(Schema.brand("AccountId"));
export type AccountId = typeof AccountIdSchema.Type;
export const AccountId = {
  prefix: "ac_" as const,
  schema: AccountIdSchema,
  make: (): AccountId => `ac_${newId()}` as AccountId,
  fromParam: (value: string): AccountId => value as AccountId,
  is: (value: unknown): value is AccountId => Schema.is(AccountIdSchema)(value),
};

export const MemberIdSchema = Schema.TemplateLiteral(["mb_", Schema.String]).pipe(Schema.brand("MemberId"));
export type MemberId = typeof MemberIdSchema.Type;
export const MemberId = {
  prefix: "mb_" as const,
  schema: MemberIdSchema,
  make: (): MemberId => `mb_${newId()}` as MemberId,
  fromParam: (value: string): MemberId => value as MemberId,
  is: (value: unknown): value is MemberId => Schema.is(MemberIdSchema)(value),
};

export const DeviceIdSchema = Schema.TemplateLiteral(["dv_", Schema.String]).pipe(Schema.brand("DeviceId"));
export type DeviceId = typeof DeviceIdSchema.Type;
export const DeviceId = {
  prefix: "dv_" as const,
  schema: DeviceIdSchema,
  make: (): DeviceId => `dv_${newId()}` as DeviceId,
  fromParam: (value: string): DeviceId => value as DeviceId,
  is: (value: unknown): value is DeviceId => Schema.is(DeviceIdSchema)(value),
};

export const PolicyIdSchema = Schema.TemplateLiteral(["pl_", Schema.String]).pipe(Schema.brand("PolicyId"));
export type PolicyId = typeof PolicyIdSchema.Type;
export const PolicyId = {
  prefix: "pl_" as const,
  schema: PolicyIdSchema,
  make: (): PolicyId => `pl_${newId()}` as PolicyId,
  fromParam: (value: string): PolicyId => value as PolicyId,
  is: (value: unknown): value is PolicyId => Schema.is(PolicyIdSchema)(value),
};

export const GroupIdSchema = Schema.TemplateLiteral(["gr_", Schema.String]).pipe(Schema.brand("GroupId"));
export type GroupId = typeof GroupIdSchema.Type;
export const GroupId = {
  prefix: "gr_" as const,
  schema: GroupIdSchema,
  make: (): GroupId => `gr_${newId()}` as GroupId,
  fromParam: (value: string): GroupId => value as GroupId,
  is: (value: unknown): value is GroupId => Schema.is(GroupIdSchema)(value),
};

export const ScriptIdSchema = Schema.TemplateLiteral(["sc_", Schema.String]).pipe(Schema.brand("ScriptId"));
export type ScriptId = typeof ScriptIdSchema.Type;
export const ScriptId = {
  prefix: "sc_" as const,
  schema: ScriptIdSchema,
  make: (): ScriptId => `sc_${newId()}` as ScriptId,
  fromParam: (value: string): ScriptId => value as ScriptId,
  is: (value: unknown): value is ScriptId => Schema.is(ScriptIdSchema)(value),
};

export const RestrictedSoftwareIdSchema = Schema.TemplateLiteral(["rs_", Schema.String]).pipe(Schema.brand("RestrictedSoftwareId"));
export type RestrictedSoftwareId = typeof RestrictedSoftwareIdSchema.Type;
export const RestrictedSoftwareId = {
  prefix: "rs_" as const,
  schema: RestrictedSoftwareIdSchema,
  make: (): RestrictedSoftwareId => `rs_${newId()}` as RestrictedSoftwareId,
  fromParam: (value: string): RestrictedSoftwareId => value as RestrictedSoftwareId,
  is: (value: unknown): value is RestrictedSoftwareId => Schema.is(RestrictedSoftwareIdSchema)(value),
};

export const EnrollmentIdSchema = Schema.TemplateLiteral(["en_", Schema.String]).pipe(Schema.brand("EnrollmentId"));
export type EnrollmentId = typeof EnrollmentIdSchema.Type;
export const EnrollmentId = {
  prefix: "en_" as const,
  schema: EnrollmentIdSchema,
  make: (): EnrollmentId => `en_${newId()}` as EnrollmentId,
  fromParam: (value: string): EnrollmentId => value as EnrollmentId,
  is: (value: unknown): value is EnrollmentId => Schema.is(EnrollmentIdSchema)(value),
};

export const AuditIdSchema = Schema.TemplateLiteral(["au_", Schema.String]).pipe(Schema.brand("AuditId"));
export type AuditId = typeof AuditIdSchema.Type;
export const AuditId = {
  prefix: "au_" as const,
  schema: AuditIdSchema,
  make: (): AuditId => `au_${newId()}` as AuditId,
  fromParam: (value: string): AuditId => value as AuditId,
  is: (value: unknown): value is AuditId => Schema.is(AuditIdSchema)(value),
};

export const SystemAuditIdSchema = Schema.TemplateLiteral(["sys_", Schema.String]).pipe(Schema.brand("SystemAuditId"));
export type SystemAuditId = typeof SystemAuditIdSchema.Type;
export const SystemAuditId = {
  prefix: "sys_" as const,
  schema: SystemAuditIdSchema,
  make: (): SystemAuditId => `sys_${newId()}` as SystemAuditId,
  fromParam: (value: string): SystemAuditId => value as SystemAuditId,
  is: (value: unknown): value is SystemAuditId => Schema.is(SystemAuditIdSchema)(value),
};

export const WebhookEventIdSchema = Schema.TemplateLiteral(["evt_", Schema.String]).pipe(Schema.brand("WebhookEventId"));
export type WebhookEventId = typeof WebhookEventIdSchema.Type;
export const WebhookEventId = {
  prefix: "evt_" as const,
  schema: WebhookEventIdSchema,
  make: (): WebhookEventId => `evt_${newId()}` as WebhookEventId,
  fromParam: (value: string): WebhookEventId => value as WebhookEventId,
  is: (value: unknown): value is WebhookEventId => Schema.is(WebhookEventIdSchema)(value),
};

export const WebhookDeliveryIdSchema = Schema.TemplateLiteral(["whd_", Schema.String]).pipe(Schema.brand("WebhookDeliveryId"));
export type WebhookDeliveryId = typeof WebhookDeliveryIdSchema.Type;
export const WebhookDeliveryId = {
  prefix: "whd_" as const,
  schema: WebhookDeliveryIdSchema,
  make: (): WebhookDeliveryId => `whd_${newId()}` as WebhookDeliveryId,
  fromParam: (value: string): WebhookDeliveryId => value as WebhookDeliveryId,
  is: (value: unknown): value is WebhookDeliveryId => Schema.is(WebhookDeliveryIdSchema)(value),
};

export const MigrationIdSchema = Schema.TemplateLiteral(["mg_", Schema.String]).pipe(Schema.brand("MigrationId"));
export type MigrationId = typeof MigrationIdSchema.Type;
export const MigrationId = {
  prefix: "mg_" as const,
  schema: MigrationIdSchema,
  make: (): MigrationId => `mg_${newId()}` as MigrationId,
  fromParam: (value: string): MigrationId => value as MigrationId,
  is: (value: unknown): value is MigrationId => Schema.is(MigrationIdSchema)(value),
};

export const MigrationEntryIdSchema = Schema.TemplateLiteral(["mge_", Schema.String]).pipe(Schema.brand("MigrationEntryId"));
export type MigrationEntryId = typeof MigrationEntryIdSchema.Type;
export const MigrationEntryId = {
  prefix: "mge_" as const,
  schema: MigrationEntryIdSchema,
  make: (): MigrationEntryId => `mge_${newId()}` as MigrationEntryId,
  fromParam: (value: string): MigrationEntryId => value as MigrationEntryId,
  is: (value: unknown): value is MigrationEntryId => Schema.is(MigrationEntryIdSchema)(value),
};

export const BackupIdSchema = Schema.TemplateLiteral(["bk_", Schema.String]).pipe(Schema.brand("BackupId"));
export type BackupId = typeof BackupIdSchema.Type;
export const BackupId = {
  prefix: "bk_" as const,
  schema: BackupIdSchema,
  make: (): BackupId => `bk_${newId()}` as BackupId,
  fromParam: (value: string): BackupId => value as BackupId,
  is: (value: unknown): value is BackupId => Schema.is(BackupIdSchema)(value),
};

export const ReportIdSchema = Schema.TemplateLiteral(["rp_", Schema.String]).pipe(Schema.brand("ReportId"));
export type ReportId = typeof ReportIdSchema.Type;
export const ReportId = {
  prefix: "rp_" as const,
  schema: ReportIdSchema,
  make: (): ReportId => `rp_${newId()}` as ReportId,
  fromParam: (value: string): ReportId => value as ReportId,
  is: (value: unknown): value is ReportId => Schema.is(ReportIdSchema)(value),
};

export const InvitationIdSchema = Schema.TemplateLiteral(["iv_", Schema.String]).pipe(Schema.brand("InvitationId"));
export type InvitationId = typeof InvitationIdSchema.Type;
export const InvitationId = {
  prefix: "iv_" as const,
  schema: InvitationIdSchema,
  make: (): InvitationId => `iv_${newId()}` as InvitationId,
  fromParam: (value: string): InvitationId => value as InvitationId,
  is: (value: unknown): value is InvitationId => Schema.is(InvitationIdSchema)(value),
};

export const TokenIdSchema = Schema.TemplateLiteral(["tk_", Schema.String]).pipe(Schema.brand("TokenId"));
export type TokenId = typeof TokenIdSchema.Type;
export const TokenId = {
  prefix: "tk_" as const,
  schema: TokenIdSchema,
  make: (): TokenId => `tk_${newId()}` as TokenId,
  fromParam: (value: string): TokenId => value as TokenId,
  is: (value: unknown): value is TokenId => Schema.is(TokenIdSchema)(value),
};

export const DashboardIdSchema = Schema.TemplateLiteral(["db_", Schema.String]).pipe(Schema.brand("DashboardId"));
export type DashboardId = typeof DashboardIdSchema.Type;
export const DashboardId = {
  prefix: "db_" as const,
  schema: DashboardIdSchema,
  make: (): DashboardId => `db_${newId()}` as DashboardId,
  fromParam: (value: string): DashboardId => value as DashboardId,
  is: (value: unknown): value is DashboardId => Schema.is(DashboardIdSchema)(value),
};

export const ViewIdSchema = Schema.TemplateLiteral(["vw_", Schema.String]).pipe(Schema.brand("ViewId"));
export type ViewId = typeof ViewIdSchema.Type;
export const ViewId = {
  prefix: "vw_" as const,
  schema: ViewIdSchema,
  make: (): ViewId => `vw_${newId()}` as ViewId,
  fromParam: (value: string): ViewId => value as ViewId,
  is: (value: unknown): value is ViewId => Schema.is(ViewIdSchema)(value),
};

export const WidgetIdSchema = Schema.TemplateLiteral(["wg_", Schema.String]).pipe(Schema.brand("WidgetId"));
export type WidgetId = typeof WidgetIdSchema.Type;
export const WidgetId = {
  prefix: "wg_" as const,
  schema: WidgetIdSchema,
  make: (): WidgetId => `wg_${newId()}` as WidgetId,
  fromParam: (value: string): WidgetId => value as WidgetId,
  is: (value: unknown): value is WidgetId => Schema.is(WidgetIdSchema)(value),
};

export const ApplicationIdSchema = Schema.TemplateLiteral(["ap_", Schema.String]).pipe(Schema.brand("ApplicationId"));
export type ApplicationId = typeof ApplicationIdSchema.Type;
export const ApplicationId = {
  prefix: "ap_" as const,
  schema: ApplicationIdSchema,
  make: (): ApplicationId => `ap_${newId()}` as ApplicationId,
  fromParam: (value: string): ApplicationId => value as ApplicationId,
  is: (value: unknown): value is ApplicationId => Schema.is(ApplicationIdSchema)(value),
};

export const InstallerIdSchema = Schema.TemplateLiteral(["in_", Schema.String]).pipe(Schema.brand("InstallerId"));
export type InstallerId = typeof InstallerIdSchema.Type;
export const InstallerId = {
  prefix: "in_" as const,
  schema: InstallerIdSchema,
  make: (): InstallerId => `in_${newId()}` as InstallerId,
  fromParam: (value: string): InstallerId => value as InstallerId,
  is: (value: unknown): value is InstallerId => Schema.is(InstallerIdSchema)(value),
};

export const DirectoryUserIdSchema = Schema.TemplateLiteral(["du_", Schema.String]).pipe(Schema.brand("DirectoryUserId"));
export type DirectoryUserId = typeof DirectoryUserIdSchema.Type;
export const DirectoryUserId = {
  prefix: "du_" as const,
  schema: DirectoryUserIdSchema,
  make: (): DirectoryUserId => `du_${newId()}` as DirectoryUserId,
  fromParam: (value: string): DirectoryUserId => value as DirectoryUserId,
  is: (value: unknown): value is DirectoryUserId => Schema.is(DirectoryUserIdSchema)(value),
};

export const DirectoryGroupIdSchema = Schema.TemplateLiteral(["dg_", Schema.String]).pipe(Schema.brand("DirectoryGroupId"));
export type DirectoryGroupId = typeof DirectoryGroupIdSchema.Type;
export const DirectoryGroupId = {
  prefix: "dg_" as const,
  schema: DirectoryGroupIdSchema,
  make: (): DirectoryGroupId => `dg_${newId()}` as DirectoryGroupId,
  fromParam: (value: string): DirectoryGroupId => value as DirectoryGroupId,
  is: (value: unknown): value is DirectoryGroupId => Schema.is(DirectoryGroupIdSchema)(value),
};

export const ScopeTagIdSchema = Schema.TemplateLiteral(["st_", Schema.String]).pipe(Schema.brand("ScopeTagId"));
export type ScopeTagId = typeof ScopeTagIdSchema.Type;
export const ScopeTagId = {
  prefix: "st_" as const,
  schema: ScopeTagIdSchema,
  make: (): ScopeTagId => `st_${newId()}` as ScopeTagId,
  fromParam: (value: string): ScopeTagId => value as ScopeTagId,
  is: (value: unknown): value is ScopeTagId => Schema.is(ScopeTagIdSchema)(value),
};

export const CredentialIdSchema = Schema.TemplateLiteral(["cr_", Schema.String]).pipe(Schema.brand("CredentialId"));
export type CredentialId = typeof CredentialIdSchema.Type;
export const CredentialId = {
  prefix: "cr_" as const,
  schema: CredentialIdSchema,
  make: (): CredentialId => `cr_${newId()}` as CredentialId,
  fromParam: (value: string): CredentialId => value as CredentialId,
  is: (value: unknown): value is CredentialId => Schema.is(CredentialIdSchema)(value),
};

export const SessionIdSchema = Schema.TemplateLiteral(["ss_", Schema.String]).pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionIdSchema.Type;
export const SessionId = {
  prefix: "ss_" as const,
  schema: SessionIdSchema,
  make: (): SessionId => `ss_${newId()}` as SessionId,
  fromParam: (value: string): SessionId => value as SessionId,
  is: (value: unknown): value is SessionId => Schema.is(SessionIdSchema)(value),
};

export const ScepCaIdSchema = Schema.TemplateLiteral(["ca_", Schema.String]).pipe(Schema.brand("ScepCaId"));
export type ScepCaId = typeof ScepCaIdSchema.Type;
export const ScepCaId = {
  prefix: "ca_" as const,
  schema: ScepCaIdSchema,
  make: (): ScepCaId => `ca_${newId()}` as ScepCaId,
  fromParam: (value: string): ScepCaId => value as ScepCaId,
  is: (value: unknown): value is ScepCaId => Schema.is(ScepCaIdSchema)(value),
};

export const FleetMigrationIdSchema = Schema.TemplateLiteral(["fm_", Schema.String]).pipe(Schema.brand("FleetMigrationId"));
export type FleetMigrationId = typeof FleetMigrationIdSchema.Type;
export const FleetMigrationId = {
  prefix: "fm_" as const,
  schema: FleetMigrationIdSchema,
  make: (): FleetMigrationId => `fm_${newId()}` as FleetMigrationId,
  fromParam: (value: string): FleetMigrationId => value as FleetMigrationId,
  is: (value: unknown): value is FleetMigrationId => Schema.is(FleetMigrationIdSchema)(value),
};

export const AdeEnrollmentIdSchema = Schema.TemplateLiteral(["ade_", Schema.String]).pipe(Schema.brand("AdeEnrollmentId"));
export type AdeEnrollmentId = typeof AdeEnrollmentIdSchema.Type;
export const AdeEnrollmentId = {
  prefix: "ade_" as const,
  schema: AdeEnrollmentIdSchema,
  make: (): AdeEnrollmentId => `ade_${newId()}` as AdeEnrollmentId,
  fromParam: (value: string): AdeEnrollmentId => value as AdeEnrollmentId,
  is: (value: unknown): value is AdeEnrollmentId => Schema.is(AdeEnrollmentIdSchema)(value),
};

export const ByodEnrollmentIdSchema = Schema.TemplateLiteral(["byod_", Schema.String]).pipe(Schema.brand("ByodEnrollmentId"));
export type ByodEnrollmentId = typeof ByodEnrollmentIdSchema.Type;
export const ByodEnrollmentId = {
  prefix: "byod_" as const,
  schema: ByodEnrollmentIdSchema,
  make: (): ByodEnrollmentId => `byod_${newId()}` as ByodEnrollmentId,
  fromParam: (value: string): ByodEnrollmentId => value as ByodEnrollmentId,
  is: (value: unknown): value is ByodEnrollmentId => Schema.is(ByodEnrollmentIdSchema)(value),
};

export const RunIdSchema = Schema.TemplateLiteral(["rn_", Schema.String]).pipe(Schema.brand("RunId"));
export type RunId = typeof RunIdSchema.Type;
export const RunId = {
  prefix: "rn_" as const,
  schema: RunIdSchema,
  make: (): RunId => `rn_${newId()}` as RunId,
  fromParam: (value: string): RunId => value as RunId,
  is: (value: unknown): value is RunId => Schema.is(RunIdSchema)(value),
};

export const OutboxMessageIdSchema = Schema.TemplateLiteral(["em_", Schema.String]).pipe(Schema.brand("OutboxMessageId"));
export type OutboxMessageId = typeof OutboxMessageIdSchema.Type;
export const OutboxMessageId = {
  prefix: "em_" as const,
  schema: OutboxMessageIdSchema,
  make: (): OutboxMessageId => `em_${newId()}` as OutboxMessageId,
  fromParam: (value: string): OutboxMessageId => value as OutboxMessageId,
  is: (value: unknown): value is OutboxMessageId => Schema.is(OutboxMessageIdSchema)(value),
};

export const LoginAttemptIdSchema = Schema.TemplateLiteral(["la_", Schema.String]).pipe(Schema.brand("LoginAttemptId"));
export type LoginAttemptId = typeof LoginAttemptIdSchema.Type;
export const LoginAttemptId = {
  prefix: "la_" as const,
  schema: LoginAttemptIdSchema,
  make: (): LoginAttemptId => `la_${newId()}` as LoginAttemptId,
  fromParam: (value: string): LoginAttemptId => value as LoginAttemptId,
  is: (value: unknown): value is LoginAttemptId => Schema.is(LoginAttemptIdSchema)(value),
};

export const RevisionIdSchema = Schema.TemplateLiteral(["rv_", Schema.String]).pipe(Schema.brand("RevisionId"));
export type RevisionId = typeof RevisionIdSchema.Type;
export const RevisionId = {
  prefix: "rv_" as const,
  schema: RevisionIdSchema,
  make: (): RevisionId => `rv_${newId()}` as RevisionId,
  fromParam: (value: string): RevisionId => value as RevisionId,
  is: (value: unknown): value is RevisionId => Schema.is(RevisionIdSchema)(value),
};

export const PreRegistrationIdSchema = Schema.TemplateLiteral(["pr_", Schema.String]).pipe(Schema.brand("PreRegistrationId"));
export type PreRegistrationId = typeof PreRegistrationIdSchema.Type;
export const PreRegistrationId = {
  prefix: "pr_" as const,
  schema: PreRegistrationIdSchema,
  make: (): PreRegistrationId => `pr_${newId()}` as PreRegistrationId,
  fromParam: (value: string): PreRegistrationId => value as PreRegistrationId,
  is: (value: unknown): value is PreRegistrationId => Schema.is(PreRegistrationIdSchema)(value),
};

export const ScopeIdSchema = Schema.TemplateLiteral(["scp_", Schema.String]).pipe(Schema.brand("ScopeId"));
export type ScopeId = typeof ScopeIdSchema.Type;
export const ScopeId = {
  prefix: "scp_" as const,
  schema: ScopeIdSchema,
  make: (): ScopeId => `scp_${newId()}` as ScopeId,
  fromParam: (value: string): ScopeId => value as ScopeId,
  is: (value: unknown): value is ScopeId => Schema.is(ScopeIdSchema)(value),
};

export const AttributeIdSchema = Schema.TemplateLiteral(["atr_", Schema.String]).pipe(Schema.brand("AttributeId"));
export type AttributeId = typeof AttributeIdSchema.Type;
export const AttributeId = {
  prefix: "atr_" as const,
  schema: AttributeIdSchema,
  make: (): AttributeId => `atr_${newId()}` as AttributeId,
  fromParam: (value: string): AttributeId => value as AttributeId,
  is: (value: unknown): value is AttributeId => Schema.is(AttributeIdSchema)(value),
};

export const EndpointIdSchema = Schema.TemplateLiteral(["ep_", Schema.String]).pipe(Schema.brand("EndpointId"));
export type EndpointId = typeof EndpointIdSchema.Type;
export const EndpointId = {
  prefix: "ep_" as const,
  schema: EndpointIdSchema,
  make: (): EndpointId => `ep_${newId()}` as EndpointId,
  fromParam: (value: string): EndpointId => value as EndpointId,
  is: (value: unknown): value is EndpointId => Schema.is(EndpointIdSchema)(value),
};

export const ConnectionIdSchema = Schema.TemplateLiteral(["cn_", Schema.String]).pipe(Schema.brand("ConnectionId"));
export type ConnectionId = typeof ConnectionIdSchema.Type;
export const ConnectionId = {
  prefix: "cn_" as const,
  schema: ConnectionIdSchema,
  make: (): ConnectionId => `cn_${newId()}` as ConnectionId,
  fromParam: (value: string): ConnectionId => value as ConnectionId,
  is: (value: unknown): value is ConnectionId => Schema.is(ConnectionIdSchema)(value),
};

export const CommandIdSchema = Schema.TemplateLiteral(["cmd_", Schema.String]).pipe(Schema.brand("CommandId"));
export type CommandId = typeof CommandIdSchema.Type;
export const CommandId = {
  prefix: "cmd_" as const,
  schema: CommandIdSchema,
  make: (): CommandId => `cmd_${newId()}` as CommandId,
  fromParam: (value: string): CommandId => value as CommandId,
  is: (value: unknown): value is CommandId => Schema.is(CommandIdSchema)(value),
};

export const ExecutionIdSchema = Schema.TemplateLiteral(["exe_", Schema.String]).pipe(Schema.brand("ExecutionId"));
export type ExecutionId = typeof ExecutionIdSchema.Type;
export const ExecutionId = {
  prefix: "exe_" as const,
  schema: ExecutionIdSchema,
  make: (): ExecutionId => `exe_${newId()}` as ExecutionId,
  fromParam: (value: string): ExecutionId => value as ExecutionId,
  is: (value: unknown): value is ExecutionId => Schema.is(ExecutionIdSchema)(value),
};

export const TagIdSchema = Schema.TemplateLiteral(["tag_", Schema.String]).pipe(Schema.brand("TagId"));
export type TagId = typeof TagIdSchema.Type;
export const TagId = {
  prefix: "tag_" as const,
  schema: TagIdSchema,
  make: (): TagId => `tag_${newId()}` as TagId,
  fromParam: (value: string): TagId => value as TagId,
  is: (value: unknown): value is TagId => Schema.is(TagIdSchema)(value),
};

export const RuleIdSchema = Schema.TemplateLiteral(["rul_", Schema.String]).pipe(Schema.brand("RuleId"));
export type RuleId = typeof RuleIdSchema.Type;
export const RuleId = {
  prefix: "rul_" as const,
  schema: RuleIdSchema,
  make: (): RuleId => `rul_${newId()}` as RuleId,
  fromParam: (value: string): RuleId => value as RuleId,
  is: (value: unknown): value is RuleId => Schema.is(RuleIdSchema)(value),
};

export const RequestIdSchema = Schema.TemplateLiteral(["req_", Schema.String]).pipe(Schema.brand("RequestId"));
export type RequestId = typeof RequestIdSchema.Type;
export const RequestId = {
  prefix: "req_" as const,
  schema: RequestIdSchema,
  make: (): RequestId => `req_${newId()}` as RequestId,
  fromParam: (value: string): RequestId => value as RequestId,
  is: (value: unknown): value is RequestId => Schema.is(RequestIdSchema)(value),
};

export const ArchiveIdSchema = Schema.TemplateLiteral(["arc_", Schema.String]).pipe(Schema.brand("ArchiveId"));
export type ArchiveId = typeof ArchiveIdSchema.Type;
export const ArchiveId = {
  prefix: "arc_" as const,
  schema: ArchiveIdSchema,
  make: (): ArchiveId => `arc_${newId()}` as ArchiveId,
  fromParam: (value: string): ArchiveId => value as ArchiveId,
  is: (value: unknown): value is ArchiveId => Schema.is(ArchiveIdSchema)(value),
};

export const ProfileIdSchema = Schema.TemplateLiteral(["prof_", Schema.String]).pipe(Schema.brand("ProfileId"));
export type ProfileId = typeof ProfileIdSchema.Type;
export const ProfileId = {
  prefix: "prof_" as const,
  schema: ProfileIdSchema,
  make: (): ProfileId => `prof_${newId()}` as ProfileId,
  fromParam: (value: string): ProfileId => value as ProfileId,
  is: (value: unknown): value is ProfileId => Schema.is(ProfileIdSchema)(value),
};

export const CertificateIdSchema = Schema.TemplateLiteral(["cert_", Schema.String]).pipe(Schema.brand("CertificateId"));
export type CertificateId = typeof CertificateIdSchema.Type;
export const CertificateId = {
  prefix: "cert_" as const,
  schema: CertificateIdSchema,
  make: (): CertificateId => `cert_${newId()}` as CertificateId,
  fromParam: (value: string): CertificateId => value as CertificateId,
  is: (value: unknown): value is CertificateId => Schema.is(CertificateIdSchema)(value),
};

export const UserIdSchema = Schema.TemplateLiteral(["usr_", Schema.String]).pipe(Schema.brand("UserId"));
export type UserId = typeof UserIdSchema.Type;
export const UserId = {
  prefix: "usr_" as const,
  schema: UserIdSchema,
  make: (): UserId => `usr_${newId()}` as UserId,
  fromParam: (value: string): UserId => value as UserId,
  is: (value: unknown): value is UserId => Schema.is(UserIdSchema)(value),
};

export const InventoryRequestIdSchema = Schema.TemplateLiteral(["ivr_", Schema.String]).pipe(Schema.brand("InventoryRequestId"));
export type InventoryRequestId = typeof InventoryRequestIdSchema.Type;
export const InventoryRequestId = {
  prefix: "ivr_" as const,
  schema: InventoryRequestIdSchema,
  make: (): InventoryRequestId => `ivr_${newId()}` as InventoryRequestId,
  fromParam: (value: string): InventoryRequestId => value as InventoryRequestId,
  is: (value: unknown): value is InventoryRequestId => Schema.is(InventoryRequestIdSchema)(value),
};

export const EmailChangeIdSchema = Schema.TemplateLiteral(["emch_", Schema.String]).pipe(Schema.brand("EmailChangeId"));
export type EmailChangeId = typeof EmailChangeIdSchema.Type;
export const EmailChangeId = {
  prefix: "emch_" as const,
  schema: EmailChangeIdSchema,
  make: (): EmailChangeId => `emch_${newId()}` as EmailChangeId,
  fromParam: (value: string): EmailChangeId => value as EmailChangeId,
  is: (value: unknown): value is EmailChangeId => Schema.is(EmailChangeIdSchema)(value),
};

export const DeploymentIdSchema = Schema.TemplateLiteral(["dep_", Schema.String]).pipe(Schema.brand("DeploymentId"));
export type DeploymentId = typeof DeploymentIdSchema.Type;
export const DeploymentId = {
  prefix: "dep_" as const,
  schema: DeploymentIdSchema,
  make: (): DeploymentId => `dep_${newId()}` as DeploymentId,
  fromParam: (value: string): DeploymentId => value as DeploymentId,
  is: (value: unknown): value is DeploymentId => Schema.is(DeploymentIdSchema)(value),
};

export const JobIdSchema = Schema.TemplateLiteral(["job_", Schema.String]).pipe(Schema.brand("JobId"));
export type JobId = typeof JobIdSchema.Type;
export const JobId = {
  prefix: "job_" as const,
  schema: JobIdSchema,
  make: (): JobId => `job_${newId()}` as JobId,
  fromParam: (value: string): JobId => value as JobId,
  is: (value: unknown): value is JobId => Schema.is(JobIdSchema)(value),
};

export const SubscriptionIdSchema = Schema.TemplateLiteral(["sub_", Schema.String]).pipe(Schema.brand("SubscriptionId"));
export type SubscriptionId = typeof SubscriptionIdSchema.Type;
export const SubscriptionId = {
  prefix: "sub_" as const,
  schema: SubscriptionIdSchema,
  make: (): SubscriptionId => `sub_${newId()}` as SubscriptionId,
  fromParam: (value: string): SubscriptionId => value as SubscriptionId,
  is: (value: unknown): value is SubscriptionId => Schema.is(SubscriptionIdSchema)(value),
};

export const WebhookIdSchema = Schema.TemplateLiteral(["wh_", Schema.String]).pipe(Schema.brand("WebhookId"));
export type WebhookId = typeof WebhookIdSchema.Type;
export const WebhookId = {
  prefix: "wh_" as const,
  schema: WebhookIdSchema,
  make: (): WebhookId => `wh_${newId()}` as WebhookId,
  fromParam: (value: string): WebhookId => value as WebhookId,
  is: (value: unknown): value is WebhookId => Schema.is(WebhookIdSchema)(value),
};

export const ApplicationUninstallIdSchema = Schema.TemplateLiteral(["un_", Schema.String]).pipe(Schema.brand("ApplicationUninstallId"));
export type ApplicationUninstallId = typeof ApplicationUninstallIdSchema.Type;
export const ApplicationUninstallId = {
  prefix: "un_" as const,
  schema: ApplicationUninstallIdSchema,
  make: (): ApplicationUninstallId => `un_${newId()}` as ApplicationUninstallId,
  fromParam: (value: string): ApplicationUninstallId => value as ApplicationUninstallId,
  is: (value: unknown): value is ApplicationUninstallId => Schema.is(ApplicationUninstallIdSchema)(value),
};

export const ApprovalIdSchema = Schema.TemplateLiteral(["appr_", Schema.String]).pipe(Schema.brand("ApprovalId"));
export type ApprovalId = typeof ApprovalIdSchema.Type;
export const ApprovalId = {
  prefix: "appr_" as const,
  schema: ApprovalIdSchema,
  make: (): ApprovalId => `appr_${newId()}` as ApprovalId,
  fromParam: (value: string): ApprovalId => value as ApprovalId,
  is: (value: unknown): value is ApprovalId => Schema.is(ApprovalIdSchema)(value),
};

export const RoleIdSchema = Schema.TemplateLiteral(["rol_", Schema.String]).pipe(Schema.brand("RoleId"));
export type RoleId = typeof RoleIdSchema.Type;
export const RoleId = {
  prefix: "rol_" as const,
  schema: RoleIdSchema,
  make: (): RoleId => `rol_${newId()}` as RoleId,
  fromParam: (value: string): RoleId => value as RoleId,
  is: (value: unknown): value is RoleId => Schema.is(RoleIdSchema)(value),
};

export const TransferIdSchema = Schema.TemplateLiteral(["tr_", Schema.String]).pipe(Schema.brand("TransferId"));
export type TransferId = typeof TransferIdSchema.Type;
export const TransferId = {
  prefix: "tr_" as const,
  schema: TransferIdSchema,
  make: (): TransferId => `tr_${newId()}` as TransferId,
  fromParam: (value: string): TransferId => value as TransferId,
  is: (value: unknown): value is TransferId => Schema.is(TransferIdSchema)(value),
};

export const RegistrationIdSchema = Schema.TemplateLiteral(["reg_", Schema.String]).pipe(Schema.brand("RegistrationId"));
export type RegistrationId = typeof RegistrationIdSchema.Type;
export const RegistrationId = {
  prefix: "reg_" as const,
  schema: RegistrationIdSchema,
  make: (): RegistrationId => `reg_${newId()}` as RegistrationId,
  fromParam: (value: string): RegistrationId => value as RegistrationId,
  is: (value: unknown): value is RegistrationId => Schema.is(RegistrationIdSchema)(value),
};

export const AuditEventIdSchema = Schema.TemplateLiteral(["ae_", Schema.String]).pipe(Schema.brand("AuditEventId"));
export type AuditEventId = typeof AuditEventIdSchema.Type;
export const AuditEventId = {
  prefix: "ae_" as const,
  schema: AuditEventIdSchema,
  make: (): AuditEventId => `ae_${newId()}` as AuditEventId,
  fromParam: (value: string): AuditEventId => value as AuditEventId,
  is: (value: unknown): value is AuditEventId => Schema.is(AuditEventIdSchema)(value),
};

export const RecoveryIdSchema = Schema.TemplateLiteral(["rec_", Schema.String]).pipe(Schema.brand("RecoveryId"));
export type RecoveryId = typeof RecoveryIdSchema.Type;
export const RecoveryId = {
  prefix: "rec_" as const,
  schema: RecoveryIdSchema,
  make: (): RecoveryId => `rec_${newId()}` as RecoveryId,
  fromParam: (value: string): RecoveryId => value as RecoveryId,
  is: (value: unknown): value is RecoveryId => Schema.is(RecoveryIdSchema)(value),
};

export const ViolationIdSchema = Schema.TemplateLiteral(["vio_", Schema.String]).pipe(Schema.brand("ViolationId"));
export type ViolationId = typeof ViolationIdSchema.Type;
export const ViolationId = {
  prefix: "vio_" as const,
  schema: ViolationIdSchema,
  make: (): ViolationId => `vio_${newId()}` as ViolationId,
  fromParam: (value: string): ViolationId => value as ViolationId,
  is: (value: unknown): value is ViolationId => Schema.is(ViolationIdSchema)(value),
};
