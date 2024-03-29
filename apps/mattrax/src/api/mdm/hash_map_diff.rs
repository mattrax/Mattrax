/// Code was originally from: https://github.com/Tesel/hash_map_diff
/// All credit goes to the original author.
use std::collections::HashMap;

#[derive(Eq, PartialEq, Debug)]
pub struct HashMapDiff<K, V>
where
    K: Eq + std::hash::Hash,
{
    pub updated: HashMap<K, V>,
    pub removed: HashMap<K, V>,
}

pub fn hash_map_diff<'a, K, V>(lhs: &'a HashMap<K, V>, rhs: &'a HashMap<K, V>) -> HashMapDiff<K, V>
where
    K: Eq + std::hash::Hash + Clone,
    V: Eq + Clone,
{
    let mut removed: HashMap<K, V> = HashMap::new();
    for (key, value) in lhs {
        if !rhs.contains_key(key) {
            removed.insert(key.clone(), value.clone());
        }
    }

    let mut updated: HashMap<K, V> = HashMap::new();
    for (key, new_value) in rhs {
        if let Some(old_value) = lhs.get(key) {
            if new_value != old_value {
                updated.insert(key.clone(), new_value.clone());
            }
        } else {
            updated.insert(key.clone(), new_value.clone());
        }
    }

    HashMapDiff { updated, removed }
}
