# Glossary

| Term                 | Meaning                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| **ABM**              | Apple Business Manager. Assigns devices to an MDM server and provides the Business API.                  |
| **ADE**              | Automated Device Enrollment. Apple's zero-touch enrollment flow driven by ABM.                           |
| **AMAPI**            | Android Management API. Google's API for Android Enterprise.                                             |
| **APNs**             | Apple Push Notification service. Wakes Apple devices for MDM check-in.                                   |
| **Autopilot**        | Windows deployment service that joins devices to Entra ID at first boot.                                 |
| **Blueprint**        | Kandji's grouping/policy concept; maps to groups and policies in Mattrax.                                |
| **Check-in**         | A device request to the MDM server: Apple `Authenticate`/`TokenUpdate`, Windows SyncML, Android Pub/Sub. |
| **Configuration**    | One platform payload inside a policy, identified by a `mttx.*` kind.                                     |
| **DDM**              | Declarative Device Management. Apple's declaration-based policy channel.                                 |
| **Device**           | A managed endpoint with a protocol, status, inventory and assignments.                                   |
| **Dynamic group**    | A group whose membership is computed from device rules.                                                  |
| **Effective policy** | The resolved set of configurations a device should receive.                                              |
| **Entra ID**         | Microsoft's identity provider; used for SSO, Windows federation and Autopilot.                           |
| **Enrollment**       | The process that gives a device an identity and management channel.                                      |
| **Include/exclude**  | Assignment mode for a policy on a group or device.                                                       |
| **JIT**              | Just-in-time membership; not used by Mattrax.                                                            |
| **Location token**   | Apple Apps & Books token that authorizes VPP asset management.                                           |
| **Manual group**     | A group with explicit device membership.                                                                 |
| **MDM**              | Mobile device management.                                                                                |
| **OMA-URI**          | Windows policy node path used in SyncML.                                                                 |
| **Policy**           | A named container with priority and configurations.                                                      |
| **Pre-registration** | A serial-based record that names and groups a device before enrollment.                                  |
| **Product key**      | A Platform API key that licenses a whitelabel gateway instance.                                          |
| **SCEP**             | Simple Certificate Enrollment Protocol. Issues Apple/Windows device identities.                          |
| **SCIM**             | System for Cross-domain Identity Management. Provisions users and groups.                                |
| **Step-up**          | A recent re-authentication required for sensitive actions.                                               |
| **SyncML**           | OMA-DM protocol used by Windows MDM.                                                                     |
| **Tenant**           | An isolated environment with its own devices, policies and billing.                                      |
| **VPP**              | Apple Volume Purchase Program, now Apps & Books.                                                         |
| **WSTEP**            | Windows certificate enrollment protocol used by MDM.                                                     |
| **Webhook**          | An outbound HMAC-signed event delivered to your endpoint.                                                |
| **Whitelabel**       | A gateway deployment embedded in your own product.                                                       |

## Next

- [Core concepts](/getting-started/concepts)
- [Architecture](/reference/architecture)
