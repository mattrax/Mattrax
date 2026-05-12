import { HttpApiBuilder } from "effect/unstable/httpapi";
import { enterpriseApi } from "@mattrax/enterprise-domain";
import { EnterpriseService } from "./service.js";

const unsafe = <A>(effect: A) => effect as any;

export const enterpriseHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseApi>) =>
  handlers
    .handle("status", () => unsafe(EnterpriseService.use((service) => service.status())))
    .handle("me", ({ request }) => unsafe(EnterpriseService.use((service) => service.me(request))))
    .handle("updateMe", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.updateMe(request, payload))))
    .handle("deleteMe", ({ request }) => unsafe(EnterpriseService.use((service) => service.deleteMe(request))))
    .handle("getEnrollment", ({ params, query }) => unsafe(EnterpriseService.use((service) => service.getEnrollment(params.id, query.code))))
    .handle("deleteTenant", ({ request }) => unsafe(EnterpriseService.use((service) => service.deleteTenant(request))))
    .handle("getApns", ({ request }) => unsafe(EnterpriseService.use((service) => service.getApns(request))))
    .handle("uploadApns", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.uploadApns(request, payload))))
    .handle("deleteDevices", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.deleteDevices(request, payload))))
    .handle("patchDevice", ({ request, params, payload }) => unsafe(EnterpriseService.use((service) => service.patchDevice(request, params.id, payload))))
    .handle("deviceAction", ({ request, params }) => unsafe(EnterpriseService.use((service) => service.deviceAction(request, params.id))))
    .handle("deviceUnenroll", ({ request, params }) => unsafe(EnterpriseService.use((service) => service.deviceUnenroll(request, params.id))))
    .handle("createGroup", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.createGroup(request, payload))))
    .handle("deleteGroups", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.deleteGroups(request, payload))))
    .handle("patchGroup", ({ request, params, payload }) => unsafe(EnterpriseService.use((service) => service.patchGroup(request, params.id, payload))))
    .handle("patchGroupMembers", ({ request, params, payload }) => unsafe(EnterpriseService.use((service) => service.patchGroupMembers(request, params.id, payload))))
    .handle("syncGroups", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.syncGroups(request, payload))))
    .handle("duplicateGroup", ({ request, params, payload }) => unsafe(EnterpriseService.use((service) => service.duplicateGroup(request, params.id, payload))))
    .handle("createPolicy", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.createPolicy(request, payload))))
    .handle("deletePolicies", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.deletePolicies(request, payload))))
    .handle("patchPolicy", ({ request, params, payload }) => unsafe(EnterpriseService.use((service) => service.patchPolicy(request, params.id, payload))))
    .handle("syncPolicies", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.syncPolicies(request, payload))))
    .handle("duplicatePolicy", ({ request, params, payload }) => unsafe(EnterpriseService.use((service) => service.duplicatePolicy(request, params.id, payload))))
    .handle("previewMobileconfig", ({ payload }) => unsafe(EnterpriseService.use((service) => service.previewMobileconfig(payload))))
    .handle("search", ({ request, query }) => unsafe(EnterpriseService.use((service) => service.search(request, query))))
    .handle("node", ({ request, params }) => unsafe(EnterpriseService.use((service) => service.node(request, params.entity, params.id))))
    .handle("billing", ({ request }) => unsafe(EnterpriseService.use((service) => service.billing(request))))
    .handle("billingPortal", ({ request, payload }) => unsafe(EnterpriseService.use((service) => service.billingPortal(request, payload))));
