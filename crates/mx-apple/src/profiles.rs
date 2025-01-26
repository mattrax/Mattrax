// TODO: Review each of the profiles

use apple_dm::{
    enroll::EnrollMobileConfigPayloadContent,
    mdm::profiles::{
        CommonPayloadKey, Mdm, MdmServerCapabilityServerCapabilitiesItem, Scep, TopLevel,
        TopLevelPayloadScope,
    },
    FlatProfile, Profile,
};

/// Generate the Apple OTA enrollment profile that is installed onto the device.
pub fn enrollment_profile(
    tenant_name: String,
    challenge: String,
    url: String,
) -> Profile<EnrollMobileConfigPayloadContent> {
    todo!();

    // TopLevel {
    //     payload_identifier: "app.mattrax.mdm.apple.ota".into(),
    //     payload_type: "Profile Service".into(),
    //     payload_uuid: "d5983c6a-1b80-4621-9395-99abde737e9e".into(),
    //     payload_version: 1,
    //     payload_display_name: Some(format!("{tenant_name} Enrollment")),
    //     payload_description: Some(format!(
    //         "Automatic configuration of your {tenant_name} device."
    //     )),
    //     payload_organization: Some(tenant_name),
    //     is_encrypted: None,
    //     encrypted_payload_content: None,
    //     has_removal_passcode: None,
    //     payload_removal_disallowed: Some(true),
    //     payload_scope: Some(TopLevelPayloadScope::System),
    //     removal_date: None,
    //     duration_until_removal: None,
    //     payload_expiration_date: None,
    //     target_device_type: None,
    //     consent_text: None,
    //     payload_content: EnrollMobileConfigPayloadContent {
    //         challenge,
    //         url,
    //         device_attributes: vec![
    //             "UDID".to_string(),
    //             "PRODUCT".to_string(),
    //             "SERIAL".to_string(),
    //             "VERSION".to_string(),
    //             "DEVICE_NAME".to_string(),
    //             // TODO: `MEID`, `IMEI`?
    //         ],
    //     },
    // }

    // Profile {
    //     common: CommonPayloadKey {
    //         payload_identifier: "app.mattrax.mdm.apple.ota".into(),
    //         payload_type: "Profile Service".into(),
    //         payload_uuid: "d5983c6a-1b80-4621-9395-99abde737e9e".into(),
    //         payload_version: 1,
    //         payload_display_name: Some(format!("{tenant_name} Enrollment")),
    //         payload_description: Some(format!(
    //             "Automatic configuration of your {tenant_name} device."
    //         )),
    //         payload_organization: Some(tenant_name),
    //     },
    //     content: EnrollMobileConfigPayloadContent {
    //         challenge,
    //         url,
    //         device_attributes: vec![
    //             "UDID".to_string(),
    //             "PRODUCT".to_string(),
    //             "SERIAL".to_string(),
    //             "VERSION".to_string(),
    //             "DEVICE_NAME".to_string(),
    //             // TODO: `MEID`, `IMEI`?
    //         ],
    //     },
    // }
}

/// Generate the Apple MDM profile that is delivered to the device via OTA enrollment.
pub fn mdm_profile(
    tenant_name: String,
    topic: String,
    challenge: String,
    scep_url: String,
    server_url: String,
    check_in_url: Option<String>,
) -> Profile<(FlatProfile<Mdm>, Profile<Scep>)> {
    // TODO: Dynamic URL's.
    // TODO: PayloadRemovalDisallowed on this???
    let scep = scep_profile(tenant_name.clone(), challenge, scep_url);

    let todo = TopLevel {
        payload_identifier: todo!(),
        payload_uuid: todo!(),
        payload_type: apple_dm::mdm::profiles::TopLevelPayloadType::Configuration,
        payload_version: todo!(),
        is_encrypted: todo!(),
        payload_content: todo!(),
        encrypted_payload_content: todo!(),
        payload_description: todo!(),
        payload_display_name: todo!(),
        has_removal_passcode: todo!(),
        payload_organization: todo!(),
        payload_removal_disallowed: todo!(),
        payload_scope: todo!(),
        removal_date: todo!(),
        duration_until_removal: todo!(),
        payload_expiration_date: todo!(),
        target_device_type: None,
        consent_text: None,
    };

    // TODO: PayloadRemovalDisallowed on this???
    Profile {
        common: CommonPayloadKey {
            payload_identifier: "app.mattrax.mdm.apple".into(),
            payload_type: "Profile Service".into(),
            payload_uuid: "d5983c6a-1b80-4621-9395-99abde737e9e".into(),
            payload_version: 1,
            payload_display_name: Some(format!("{tenant_name} Enrollment")),
            payload_description: Some(format!(
                "Automatic configuration of your {tenant_name} device."
            )),
            payload_organization: Some(tenant_name),
        },
        content: (
            FlatProfile {
                common: CommonPayloadKey {
                    payload_identifier: "app.mattrax.mdm.apple.enrollment".into(),
                    payload_uuid: "f45fb21f-ef0c-4f3f-b27f-a1cd7d68fe3c".into(),
                    payload_type: "com.apple.mdm".into(),
                    payload_version: 1,
                    payload_display_name: None,
                    payload_description: None,
                    payload_organization: None,
                },
                content: apple_dm::mdm::profiles::Mdm {
                    identity_certificate_uuid: scep.common.payload_uuid.clone(),
                    topic,
                    server_url,
                    check_in_url,
                    sign_message: Some(true),
                    access_rights: Some(8191),
                    use_development_apns: None,
                    managed_apple_id: None,
                    assigned_managed_apple_id: None,
                    enrollment_mode: None,
                    server_url_pinning_certificate_uui_ds: None,
                    check_in_url_pinning_certificate_uui_ds: None,
                    pinning_revocation_check_required: None,
                    server_capabilities: Some(vec![
                        MdmServerCapabilityServerCapabilitiesItem::ComAppleMdmBootstraptoken,
                        MdmServerCapabilityServerCapabilitiesItem::ComAppleMdmPerUserConnection,
                        // MdmServerCapabilitiesItem::ComAppleMdmToken, // TODO: Support this
                    ]),
                    check_out_when_removed: Some(true),
                    required_app_id_for_mdm: None,
                    prompt_user_to_allow_bootstrap_token_for_authentication: None,
                },
            },
            scep,
        ),
    }
}

/// Generate the Apple SCEP profile that is delivered to the device via OTA enrollment and included in the final enrollment profile.
pub fn scep_profile(tenant_name: String, challenge: String, scep_url: String) -> Profile<Scep> {
    Profile {
        common: CommonPayloadKey {
            payload_identifier: "app.mattrax.mdm.apple.scep".into(),
            payload_uuid: "4f7f193f-edb6-4fa9-afc7-9796b3052469".into(),
            payload_type: "com.apple.security.scep".into(),
            payload_version: 1,
            payload_display_name: None,
            payload_description: None,
            payload_organization: None,
        },
        content: Scep {
            url: Some(scep_url),
            name: Some("identity".into()),
            subject: Some(vec![vec![vec!["CN".into(), "Mattrax Identity".into()]]].into()),
            challenge: Some(challenge),
            keysize: Some(2048),
            key_type: None,
            key_usage: Some(5),
            ca_fingerprint: None,
            retries: None,
            retry_delay: None,
            subject_alt_name: None,
            key_is_extractable: Some(false),
            allow_all_apps_access: Some(false),
        },
    }
}
