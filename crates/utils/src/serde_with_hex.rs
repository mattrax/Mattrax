use serde::{Deserialize, Deserializer};

pub fn deserialize<'de, D>(d: D) -> Result<[u8; 32], D::Error>
where
    D: Deserializer<'de>,
{
    let mut bytes = [0; 32];
    let s: &str = Deserialize::deserialize(d)?;
    hex::decode_to_slice(s, &mut bytes).map_err(serde::de::Error::custom)?;
    Ok(bytes)
}

pub fn serialize<S>(bytes: &[u8; 32], s: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    s.serialize_str(&hex::encode(bytes))
}
