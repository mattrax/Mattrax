use axum::http::request::Parts;
use lambda_http::{request::RequestContext, RequestExt};
use ms_mdm::{
    Add, CmdId, CmdRef, Final, Format, Item, Meta, MsgRef, Status, SyncBody, SyncHdr, SyncML,
    Target,
};
use mx_manage::{Application, Authentication, DeviceInformation};
use std::{borrow::Cow, error::Error, str::FromStr};

pub(super) struct App {
    pub(super) manage_domain: String,
    pub(super) enrollment_domain: String,
    pub(super) cert: rcgen::Certificate,
    pub(super) key: rcgen::KeyPair,
}

impl Application for App {
    type EnrollmentAuthenticationMetadata = ();
    type ManagementAuthenticationMetadata = ();
    type Error = Box<dyn Error>;

    fn enrollment_domain(&self) -> Cow<'_, str> {
        Cow::Borrowed(&self.enrollment_domain)
    }

    fn manage_domain(&self) -> Cow<'_, str> {
        Cow::Borrowed(&self.manage_domain)
    }

    fn identity_keypair(&self) -> (&rcgen::Certificate, &rcgen::KeyPair) {
        (&self.cert, &self.key)
    }

    fn determine_authentication_method(&self) -> Authentication {
        Authentication::Federated {
            url: format!("https://{}/auth", self.enrollment_domain).into(),
        }
    }

    fn verify_authentication(
        &self,
        bst: String,
    ) -> Result<Option<Self::EnrollmentAuthenticationMetadata>, Self::Error> {
        // TODO: Make this actually do stuff
        Ok(Some(()))
    }

    async fn create_device(
        &self,
        auth: Self::EnrollmentAuthenticationMetadata,
        device: DeviceInformation,
    ) -> Result<(), Self::Error> {
        // TODO: Do this

        Ok(())
    }

    fn authenticate_management_session(
        &self,
        req: &Parts,
    ) -> Result<Option<Self::ManagementAuthenticationMetadata>, Self::Error> {
        let ctx = match req.request_context_ref() {
            Some(RequestContext::ApiGatewayV2(ctx)) => ctx.authentication.clone(),
            _ => todo!(),
        };

        // TODO
        println!("{req:?} {ctx:?}");

        Ok(Some(()))
    }

    async fn manage(
        &self,
        auth: Self::ManagementAuthenticationMetadata,
        body: String,
    ) -> Result<String, Self::Error> {
        let cmd = match SyncML::from_str(&body) {
            Ok(cmd) => cmd,
            Err(err) => {
                println!("\nBODY: {body}\n");
                panic!("{:?}", err); // TODO: Error handling
            }
        };

        // TODO: Do this helper better
        let mut cmd_id = 0;
        let mut next_cmd_id = move || {
            cmd_id += 1;
            CmdId::new(format!("{}", cmd_id)).expect("can't be zero")
        };

        let mut children = vec![
            Status {
                cmd_id: next_cmd_id(),
                msg_ref: MsgRef::from(&cmd.hdr),
                cmd_ref: CmdRef::zero(), // TODO: Remove `zero` function and use special helper???
                cmd: "SyncHdr".into(),
                data: "200".into(),
                // data: Data {
                //     msft_originalerror: None,
                //     child: "200".into(), // TODO: Use SyncML status abstraction
                // },
                item: vec![],
                target_ref: None,
                source_ref: None,
            }
            .into(),
            Add {
                cmd_id: next_cmd_id(),
                meta: None,
                item: vec![Item {
                    source: None,
                    target: Some(Target::new(
                        "./User/Vendor/MSFT/Policy/Config/Education/AllowGraphingCalculator",
                    )),
                    meta: Some(Meta {
                        format: Some(Format {
                            xmlns: "syncml:metinf".into(),
                            value: "int".into(),
                        }),
                        ttype: None,
                    }),
                    data: Some("0".into()),
                }],
            }
            .into(),
        ];

        let hdr = cmd.hdr.clone();
        let response = SyncML {
            hdr: SyncHdr {
                version: hdr.version,
                version_protocol: hdr.version_protocol,
                session_id: hdr.session_id,
                msg_id: hdr.msg_id,
                target: hdr.source.into(),
                source: hdr.target.into(),
                // TODO: Make this work
                meta: None,
                // meta: Some(Meta {
                //     max_request_body_size: Some(MAX_REQUEST_BODY_SIZE),
                // }),
            },
            child: SyncBody {
                children,
                _final: Some(Final),
            },
        };

        Ok(response.to_string().unwrap()) // TODO: Error handling
    }
}
