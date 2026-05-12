import { HttpApiBuilder } from "effect/unstable/httpapi";
import { enterpriseApi } from "@mattrax/enterprise-domain";
import { EnterpriseService } from "./service.js";

export const enterpriseHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseApi>) =>
  handlers
    .handle("status", () => EnterpriseService.use((service) => service.status()))
    .handle("me", ({ request }) => EnterpriseService.use((service) => service.me(request)))
    .handle("updateMe", ({ request, payload }) => EnterpriseService.use((service) => service.updateMe(request, payload)))
    .handle("deleteMe", ({ request }) => EnterpriseService.use((service) => service.deleteMe(request)))
    .handle("getEnrollment", ({ params, query }) => EnterpriseService.use((service) => service.getEnrollment(params.id, query.code)))
    .handle("deleteTenant", ({ request }) => EnterpriseService.use((service) => service.deleteTenant(request)))
    .handle("getApns", ({ request }) => EnterpriseService.use((service) => service.getApns(request)))
    .handle("uploadApns", ({ request, payload }) => EnterpriseService.use((service) => service.uploadApns(request, payload)))
    .handle("deleteDevices", ({ request, payload }) => EnterpriseService.use((service) => service.deleteDevices(request, payload)))
    .handle("patchDevice", ({ request, params, payload }) => EnterpriseService.use((service) => service.patchDevice(request, params.id, payload)))
    .handle("deviceAction", ({ request, params }) => EnterpriseService.use((service) => service.deviceAction(request, params.id)))
    .handle("deviceUnenroll", ({ request, params }) => EnterpriseService.use((service) => service.deviceUnenroll(request, params.id)))
    .handle("createGroup", ({ request, payload }) => EnterpriseService.use((service) => service.createGroup(request, payload)))
    .handle("deleteGroups", ({ request, payload }) => EnterpriseService.use((service) => service.deleteGroups(request, payload)))
    .handle("patchGroup", ({ request, params, payload }) => EnterpriseService.use((service) => service.patchGroup(request, params.id, payload)))
    .handle("patchGroupMembers", ({ request, params, payload }) => EnterpriseService.use((service) => service.patchGroupMembers(request, params.id, payload)))
    .handle("syncGroups", ({ request, payload }) => EnterpriseService.use((service) => service.syncGroups(request, payload)))
    .handle("duplicateGroup", ({ request, params, payload }) => EnterpriseService.use((service) => service.duplicateGroup(request, params.id, payload)))
    .handle("createPolicy", ({ request, payload }) => EnterpriseService.use((service) => service.createPolicy(request, payload)))
    .handle("deletePolicies", ({ request, payload }) => EnterpriseService.use((service) => service.deletePolicies(request, payload)))
    .handle("patchPolicy", ({ request, params, payload }) => EnterpriseService.use((service) => service.patchPolicy(request, params.id, payload)))
    .handle("syncPolicies", ({ request, payload }) => EnterpriseService.use((service) => service.syncPolicies(request, payload)))
    .handle("duplicatePolicy", ({ request, params, payload }) => EnterpriseService.use((service) => service.duplicatePolicy(request, params.id, payload)))
    .handle("previewMobileconfig", ({ payload }) => EnterpriseService.use((service) => service.previewMobileconfig(payload)))
    .handle("search", ({ request, query }) => EnterpriseService.use((service) => service.search(request, query)))
    .handle("node", ({ request, params }) => EnterpriseService.use((service) => service.node(request, params.entity, params.id)))
    .handle("billing", ({ request }) => EnterpriseService.use((service) => service.billing(request)))
    .handle("billingPortal", ({ request, payload }) => EnterpriseService.use((service) => service.billingPortal(request, payload)));
