import { admxPairKey } from "./zip.js";
import { matchAdmxCataloguePolicy } from "./catalogue.js";
import { parseAdmxFile } from "./parse.js";
import {
  admxAppName,
  admxFileId,
  admxInboxPolicyOmaUri,
  admxInstallOmaUri,
  admxVendorPolicyOmaUri,
} from "./translate.js";
import type {
  AdmxBundle,
  AdmxCatalogueIndex,
  AdmxDiscoveredPolicy,
  AdmxFileSummary,
  AdmxImportIssue,
  AdmxInputFile,
  AdmxPolicy,
} from "./types.js";
import { ADMX_LIMITS } from "./xml.js";

/**
 * Turn uploaded files into policies the designer can add.
 *
 * ADMX and ADML files are paired by base name (`chrome.admx` with
 * `en-US/chrome.adml`). Microsoft in-box templates are matched against the
 * generated catalogue lookup; everything else is a vendor template and uses
 * the `ADMXInstall` ingestion path. A policy that cannot be delivered is kept
 * in the result with an `unmappable` reason so the review screen can list it
 * instead of silently dropping it.
 */

export type ParseAdmxBundleOptions = {
  readonly catalogue?: AdmxCatalogueIndex;
  readonly maxPolicies?: number;
};

const INBOX_NAMESPACE = /^microsoft\.policies\./i;

const isInbox = (namespace: string | undefined) =>
  namespace !== undefined && INBOX_NAMESPACE.test(namespace);

const scopeFor = (policy: AdmxPolicy) =>
  policy.className === "user" ? ("user" as const) : ("device" as const);

const unsupportedReason = (policy: AdmxPolicy) =>
  policy.unsupported.length > 0
    ? `Unsupported ADMX constructs: ${policy.unsupported.join("; ")}.`
    : undefined;

export const parseAdmxBundle = (
  files: readonly AdmxInputFile[],
  options: ParseAdmxBundleOptions = {},
): AdmxBundle => {
  const maxPolicies = options.maxPolicies ?? ADMX_LIMITS.maxPolicies;

  const admxFiles = files.filter((file) => /\.admx$/i.test(file.name));

  if (admxFiles.length === 0)
    return {
      files: [],
      policies: [],
      issues: [
        {
          severity: "error",
          message: "No .admx file was found. Add an ADMX template and its matching ADML file.",
        },
      ],
      truncated: false,
    };

  const admlByKey = new Map<string, AdmxInputFile>();

  for (const file of files) {
    if (!/\.adml$/i.test(file.name)) continue;
    const key = admxPairKey(file.name);

    // Prefer an English ADML if the archive carries several languages; the
    // base name is what pairs it, so any language would be technically valid.
    if (!admlByKey.has(key) || /(^|\/)en-us\//i.test(file.name)) admlByKey.set(key, file);
  }

  const summaries: AdmxFileSummary[] = [];
  const discovered: AdmxDiscoveredPolicy[] = [];
  const issues: AdmxImportIssue[] = [];
  let truncated = false;

  for (const file of admxFiles) {
    if (truncated) break;

    const adml = admlByKey.get(admxPairKey(file.name));

    try {
      const parsed = parseAdmxFile(file.text, adml?.text, { fileName: file.name });

      for (const warning of parsed.warnings)
        issues.push({ severity: "warning", fileName: file.name, message: warning });

      if (!adml)
        issues.push({
          severity: "warning",
          fileName: file.name,
          message: `No ADML file matched "${file.name}"; labels fall back to template ids.`,
        });

      const source = isInbox(parsed.namespace) ? "inbox" : "vendor";
      // Zip entries carry a directory prefix; the app and file ids come from
      // the template's own name, not from where it sat in the archive.
      const baseName = file.name.split("/").pop() ?? file.name;

      const appName = admxAppName({
        namespace: parsed.namespace,
        prefix: parsed.prefix,
        fileName: baseName,
      });

      const fileId = admxFileId(baseName);

      for (const policy of parsed.policies) {
        if (discovered.length >= maxPolicies) {
          truncated = true;

          break;
        }

        const scope = scopeFor(policy);
        const unsupported = unsupportedReason(policy);

        if (source === "inbox") {
          const match = matchAdmxCataloguePolicy(
            {
              name: policy.name,
              className: policy.className,
              ...(parsed.namespace ? { namespace: parsed.namespace } : {}),
              ...(parsed.prefix ? { prefix: parsed.prefix } : {}),
              fileName: baseName,
            },
            options.catalogue,
          );

          if (match.status === "unmatched") {
            discovered.push({
              policy,
              admxFileName: file.name,
              source,
              appName,
              fileId,
              scope,
              omaUri: "",
              ...(unsupported ? { unmappable: unsupported } : { unmappable: match.reason }),
            });

            continue;
          }

          discovered.push({
            policy,
            admxFileName: file.name,
            source,
            appName,
            fileId,
            scope,
            omaUri: admxInboxPolicyOmaUri({
              area: match.entry.area,
              policyName: match.entry.policyName,
              scope: match.entry.scope,
            }),
            catalogueEntry: match.entry,
            ...(unsupported ? { unmappable: unsupported } : {}),
          });

          continue;
        }

        const ingestionUri = admxInstallOmaUri(appName, fileId);

        discovered.push({
          policy,
          admxFileName: file.name,
          source,
          appName,
          fileId,
          scope,
          omaUri: admxVendorPolicyOmaUri({
            appName,
            categoryPath: policy.categoryPath,
            policyName: policy.name,
            scope,
          }),
          ingestionUri,
          admxPayload: file.text,
          ...(unsupported ? { unmappable: unsupported } : {}),
        });
      }

      summaries.push({ fileName: file.name, policyCount: parsed.policies.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The ADMX file could not be read.";

      summaries.push({ fileName: file.name, policyCount: 0, error: message });
      issues.push({ severity: "error", fileName: file.name, message });
    }
  }

  if (truncated)
    issues.push({
      severity: "error",
      message: `The import contains more than ${maxPolicies} policies. Only the first ${maxPolicies} were read; split the template files and import them separately.`,
    });

  return { files: summaries, policies: discovered, issues, truncated };
};
