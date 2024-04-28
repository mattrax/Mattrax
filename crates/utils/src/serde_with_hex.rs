use serde::{Deserialize, Deserializer};

pub fn deserialize<'de, D>(d: D) -> Result<Vec<u8>, D::Error>
where
    D: Deserializer<'de>,
{
    let s: &str = Deserialize::deserialize(d)?;
    hex::decode(s).map_err(serde::de::Error::custom)
}

pub fn serialize<S>(bytes: &Vec<u8>, s: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    s.serialize_str(&hex::encode(bytes))
}
