//! Convert `rusqlite` rows into JSON objects for the React client.

use rusqlite::types::ValueRef;
use rusqlite::Row;
use serde_json::{json, Map, Value};

pub fn sqlite_row_to_object(row: &Row<'_>) -> rusqlite::Result<Value> {
    let mut m = Map::new();
    let cref = row.as_ref();
    for i in 0..cref.column_count() {
        let name = cref.column_name(i).unwrap_or("").to_string();
        let val = value_ref_to_json(row.get_ref(i)?);
        m.insert(name, val);
    }
    Ok(Value::Object(m))
}

fn value_ref_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::String(format!("<{} bytes>", b.len())),
    }
}
