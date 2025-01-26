use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use tower_cookies::{Cookie, Cookies};

use crate::Core;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "use")]
pub enum Token {
    #[serde(rename = "a")]
    Authentication {
        // The id of the account.
        sub: String,
        // The expiry of the token.
        exp: u64,
    },
    #[serde(rename = "e")]
    Enrollment {
        // The tenant id.
        sub: String,
        // The expiry of the token.
        exp: u64,
    },
    // TODO: Deprecate the previous tokens and move to proper session management which allows refreshing tokens.
    // #[serde(rename = "s")]
    // Session {
    //     // The id of the session.
    //     sub: String,
    // },
}

impl Token {
    pub fn encode(&self, core: &Core) -> String {
        encode(
            &Header::default(),
            &self,
            &EncodingKey::from_secret(&core.secret),
        )
        .unwrap()
    }

    pub fn set(&self, core: &Core, cookies: &Cookies) {
        let token = encode(
            &Header::default(),
            &self,
            &EncodingKey::from_secret(&core.secret),
        )
        .unwrap();

        cookies.add(
            Cookie::build(("session", token))
                .path("/")
                .secure(true)
                .http_only(true)
                // TODO: Should we set samesite attributes, etc?
                .build(),
        );
    }

    pub fn from_cookies(core: &Core, cookies: &Cookies) -> Option<Self> {
        let token = cookies.get("session")?;
        decode::<Token>(
            token.value(),
            &DecodingKey::from_secret(&core.secret),
            &Validation::default(),
        )
        .map_err(|err| println!("{err:?}"))
        .ok()
        .map(|data| data.claims)
    }

    pub fn account_id(&self) -> &str {
        match self {
            Token::Authentication { sub, .. } => sub,
            Token::Enrollment { .. } => todo!(),
        }
    }
}
