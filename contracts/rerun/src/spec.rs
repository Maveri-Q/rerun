//! ClaimSpec: the research claim a market is about. Stored on-chain in canonical JSON
//! (sorted keys, no whitespace); `spec_hash = sha256(canonical bytes)`.
//!
//! Metric values are decimal strings, never JSON floats, so the canonical bytes and the
//! comparison are identical in every language.

use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value};
use near_sdk::{env, near, AccountId};

use crate::math::{parse_decimal, ToleranceKind};

pub const MAX_SPEC_BYTES: usize = 8 * 1024;
pub const MAX_DATA_FILES: usize = 16;

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct ClaimSpec {
    version: u32,
    title: String,
    statement: String,
    source: Source,
    artifact: Artifact,
    metric: Metric,
    resources: Resources,
    private_data: Option<PrivateData>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Source {
    #[serde(rename = "type")]
    kind: String,
    url: String,
    doi: Option<String>,
    license: String,
    authors: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Artifact {
    repo_url: String,
    commit: String,
    data: Vec<DataFile>,
    runtime: String,
    setup: Vec<String>,
    entrypoint: String,
    output: Output,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct DataFile {
    url: String,
    sha256: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Output {
    path: String,
    extractor: Extractor,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Extractor {
    #[serde(rename = "type")]
    kind: String,
    expr: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Metric {
    name: String,
    reported_value: String,
    tolerance: Tolerance,
    comparison: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Tolerance {
    #[serde(rename = "type")]
    kind: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Resources {
    cpu: u32,
    mem_gb: u32,
    max_minutes: u32,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct PrivateData {
    ciphertext_ref: String,
    sha256_plain: String,
    owner: AccountId,
}

/// The parts of a spec the contract needs later to check receipts.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct SpecSummary {
    pub spec_hash: String,
    pub title: String,
    pub commit: String,
    pub data_hashes: Vec<String>,
    pub reported_value: String,
    pub tolerance_kind: String,
    pub tolerance_value: String,
    pub max_minutes: u32,
    pub private_data: bool,
}

impl SpecSummary {
    pub fn tolerance(&self) -> (ToleranceKind, i128) {
        let kind = if self.tolerance_kind == "rel" { ToleranceKind::Rel } else { ToleranceKind::Abs };
        (kind, parse_decimal(&self.tolerance_value).expect("validated at creation"))
    }
}

/// Validates `spec_json` and returns its summary. Rejects anything that is not already in
/// canonical form, so the stored bytes are exactly the bytes that were hashed.
pub fn validate(spec_json: &str) -> Result<SpecSummary, String> {
    if spec_json.len() > MAX_SPEC_BYTES {
        return Err(format!("spec is {} bytes, max {MAX_SPEC_BYTES}", spec_json.len()));
    }
    let value: Value = serde_json::from_str(spec_json).map_err(|e| format!("spec is not JSON: {e}"))?;
    if !no_floats(&value) {
        return Err("spec must not contain non-integer numbers; use decimal strings".into());
    }
    // serde_json's Map is a BTreeMap (sorted keys) and `to_string` emits no whitespace.
    if serde_json::to_string(&value).unwrap() != spec_json {
        return Err("spec is not canonical JSON (sorted keys, no whitespace)".into());
    }
    let spec: ClaimSpec = serde_json::from_value(value).map_err(|e| format!("invalid spec: {e}"))?;

    check(spec.version == 1, "version must be 1")?;
    check_len("title", &spec.title, 1, 120)?;
    check_len("statement", &spec.statement, 1, 600)?;

    let s = &spec.source;
    check(matches!(s.kind.as_str(), "paper" | "report" | "dataset" | "onchain"), "source.type must be paper|report|dataset|onchain")?;
    check_url("source.url", &s.url)?;
    if let Some(doi) = &s.doi {
        check_len("source.doi", doi, 1, 200)?;
    }
    check_len("source.license", &s.license, 1, 200)?;
    check_len("source.authors", &s.authors, 1, 500)?;

    let a = &spec.artifact;
    check_url("artifact.repo_url", &a.repo_url)?;
    check(is_hex(&a.commit, 40), "artifact.commit must be a full 40-char lowercase hex SHA")?;
    check(a.data.len() <= MAX_DATA_FILES, "too many data files")?;
    for d in &a.data {
        check_url("artifact.data.url", &d.url)?;
        check(is_hex(&d.sha256, 64), "artifact.data.sha256 must be 64 lowercase hex chars")?;
        check_rel_path("artifact.data.path", &d.path)?;
    }
    check(matches!(a.runtime.as_str(), "python3.11" | "r4.4"), "artifact.runtime must be python3.11|r4.4")?;
    check(a.setup.len() <= 16, "too many setup commands")?;
    for cmd in &a.setup {
        check_len("artifact.setup[]", cmd, 1, 300)?;
    }
    check_len("artifact.entrypoint", &a.entrypoint, 1, 300)?;
    check_rel_path("artifact.output.path", &a.output.path)?;
    check(
        matches!(a.output.extractor.kind.as_str(), "jsonpath" | "regex" | "csv_cell"),
        "extractor.type must be jsonpath|regex|csv_cell",
    )?;
    check_len("extractor.expr", &a.output.extractor.expr, 1, 300)?;

    let m = &spec.metric;
    check_len("metric.name", &m.name, 1, 80)?;
    parse_decimal(&m.reported_value).map_err(|e| format!("metric.reported_value: {e}"))?;
    check(matches!(m.tolerance.kind.as_str(), "abs" | "rel"), "metric.tolerance.type must be abs|rel")?;
    let tol = parse_decimal(&m.tolerance.value).map_err(|e| format!("metric.tolerance.value: {e}"))?;
    check(tol > 0, "metric.tolerance.value must be > 0")?;
    check(m.comparison == "within_tolerance", "metric.comparison must be within_tolerance")?;

    let r = &spec.resources;
    check((1..=8).contains(&r.cpu), "resources.cpu must be 1..=8")?;
    check((1..=32).contains(&r.mem_gb), "resources.mem_gb must be 1..=32")?;
    check((1..=120).contains(&r.max_minutes), "resources.max_minutes must be 1..=120")?;

    if let Some(p) = &spec.private_data {
        check_len("private_data.ciphertext_ref", &p.ciphertext_ref, 1, 300)?;
        check(is_hex(&p.sha256_plain, 64), "private_data.sha256_plain must be 64 lowercase hex chars")?;
        let _ = &p.owner; // validated by AccountId deserialisation
    }

    Ok(SpecSummary {
        spec_hash: hex(&env::sha256(spec_json.as_bytes())),
        title: spec.title,
        commit: spec.artifact.commit,
        data_hashes: spec.artifact.data.into_iter().map(|d| d.sha256).collect(),
        reported_value: spec.metric.reported_value,
        tolerance_kind: spec.metric.tolerance.kind,
        tolerance_value: spec.metric.tolerance.value,
        max_minutes: r.max_minutes,
        private_data: spec.private_data.is_some(),
    })
}

fn no_floats(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.is_u64() || n.is_i64(),
        Value::Array(a) => a.iter().all(no_floats),
        Value::Object(o) => o.values().all(no_floats),
        _ => true,
    }
}

fn check(ok: bool, msg: &str) -> Result<(), String> {
    if ok { Ok(()) } else { Err(msg.to_string()) }
}

fn check_len(field: &str, s: &str, min: usize, max: usize) -> Result<(), String> {
    let n = s.chars().count();
    check(n >= min && n <= max, &format!("{field} must be {min}..={max} characters"))
}

fn check_url(field: &str, s: &str) -> Result<(), String> {
    check_len(field, s, 9, 500)?;
    check(s.starts_with("https://") && !s.contains(char::is_whitespace), &format!("{field} must be an https:// URL"))
}

fn check_rel_path(field: &str, s: &str) -> Result<(), String> {
    check_len(field, s, 1, 200)?;
    let ok = !s.starts_with('/') && !s.contains('\\') && !s.split('/').any(|seg| seg == ".." || seg.is_empty());
    check(ok, &format!("{field} must be a relative path without '..'"))
}

pub fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn sample_spec() -> Value {
        serde_json::json!({
            "version": 1,
            "title": "Model X scores 91.2% on dataset Y",
            "statement": "The released code reproduces 91.2% test accuracy.",
            "source": { "type": "paper", "url": "https://example.org/paper", "license": "CC-BY-4.0", "authors": "A. Author" },
            "artifact": {
                "repo_url": "https://github.com/example/model-x",
                "commit": "0123456789abcdef0123456789abcdef01234567",
                "data": [{ "url": "https://example.org/y.csv", "sha256": "ab".repeat(32), "path": "data/y.csv" }],
                "runtime": "python3.11",
                "setup": ["pip install -r requirements.txt"],
                "entrypoint": "python reproduce.py",
                "output": { "path": "results.json", "extractor": { "type": "jsonpath", "expr": "$.accuracy" } }
            },
            "metric": { "name": "accuracy", "reported_value": "0.912", "tolerance": { "type": "abs", "value": "0.01" }, "comparison": "within_tolerance" },
            "resources": { "cpu": 2, "mem_gb": 4, "max_minutes": 15 },
            "private_data": null
        })
    }

    pub fn canonical(v: &Value) -> String {
        serde_json::to_string(v).unwrap()
    }

    #[test]
    fn accepts_a_valid_spec_and_hashes_canonical_bytes() {
        let json = canonical(&sample_spec());
        let s = validate(&json).unwrap();
        assert_eq!(s.spec_hash, hex(&env::sha256(json.as_bytes())));
        assert_eq!(s.commit, "0123456789abcdef0123456789abcdef01234567");
        assert_eq!(s.data_hashes, vec!["ab".repeat(32)]);
    }

    #[test]
    fn matches_the_typescript_canonical_hash() {
        // Same bytes as packages/shared canonicalJson(): sorted keys, no whitespace.
        let json = r#"{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}"#;
        let v: Value = serde_json::from_str(json).unwrap();
        assert_eq!(canonical(&v), json);
    }

    #[test]
    fn rejects_non_canonical_or_invalid_specs() {
        let json = canonical(&sample_spec());
        assert!(validate(&json.replacen(':', ": ", 1)).unwrap_err().contains("canonical"));

        let bad = |f: &dyn Fn(&mut Value), needle: &str| {
            let mut v = sample_spec();
            f(&mut v);
            let err = validate(&canonical(&v)).unwrap_err();
            assert!(err.contains(needle), "expected '{needle}' in '{err}'");
        };
        bad(&|v| v["artifact"]["commit"] = "main".into(), "40-char");
        bad(&|v| v["artifact"]["data"][0]["sha256"] = "AB".repeat(32).into(), "sha256");
        bad(&|v| v["artifact"]["data"][0]["path"] = "../etc/passwd".into(), "relative path");
        bad(&|v| v["metric"]["tolerance"]["value"] = "0".into(), "> 0");
        bad(&|v| v["metric"]["reported_value"] = 0.912.into(), "decimal strings");
        bad(&|v| v["artifact"]["repo_url"] = "http://github.com/x".into(), "https://");
        bad(&|v| v["extra"] = 1.into(), "unknown field");
    }
}
