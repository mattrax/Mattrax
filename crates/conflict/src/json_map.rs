use std::{
    collections::HashMap,
    hash::Hash,
    ops::{Deref, DerefMut},
};

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A `HashMap` wrapper that allows it to be serialized as an array of tuples in JSON as JSON doesn't support non-string keys.
#[derive(Debug, PartialEq, Eq)]
pub struct JsonMap<K, V>(pub HashMap<K, V>)
where
    K: Hash + Eq;

impl<K, V> JsonMap<K, V>
where
    K: Hash + Eq,
{
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl<K, V> Default for JsonMap<K, V>
where
    K: Hash + Eq,
{
    fn default() -> Self {
        Self(Default::default())
    }
}

impl<K, V> Deref for JsonMap<K, V>
where
    K: Hash + Eq,
{
    type Target = HashMap<K, V>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<K, V> DerefMut for JsonMap<K, V>
where
    K: Hash + Eq,
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl<K, V> Serialize for JsonMap<K, V>
where
    K: Serialize + Hash + Eq,
    V: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.iter().collect::<Vec<_>>().serialize(serializer)
    }
}

impl<'a, K, V> Deserialize<'a> for JsonMap<K, V>
where
    K: Deserialize<'a> + Eq + Hash,
    V: Deserialize<'a>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'a>,
    {
        Ok(JsonMap(
            Vec::<(K, V)>::deserialize(deserializer)?
                .into_iter()
                .collect(),
        ))
    }
}
