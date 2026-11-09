//! Lab registry. A Lab may act only while registered *and* its codehash is approved, so
//! revoking a codehash blocks its proposals immediately.
//!
//! A Lab in secure hardware is registered with `register_lab_attested`: the owner checks its quote
//! off-chain (`pnpm phala:register`) and records the fingerprint of the whole attestation here, so
//! anyone can fetch the same attestation from the Lab and check it again. Verifying a TDX quote inside
//! the contract would multiply its size, and its storage cost with it. Testnet builds also keep
//! `register_lab_local`, for a Lab with no secure hardware.

use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::events::emit;
use crate::spec::is_hex;
use crate::types::Lab;
use crate::*;

#[near]
impl Contract {
    pub fn approve_codehash(&mut self, codehash: String) {
        self.assert_owner();
        require!(is_hex(&codehash, 64), "codehash must be sha256 hex");
        self.approved_codehashes.insert(codehash.clone());
        emit("codehash_approved", json!({ "codehash": codehash }));
    }

    pub fn revoke_codehash(&mut self, codehash: String) {
        self.assert_owner();
        require!(self.approved_codehashes.remove(&codehash), "codehash not approved");
        emit("codehash_revoked", json!({ "codehash": codehash }));
    }

    /// Owner-registered Lab without TEE attestation. Not compiled into mainnet builds.
    #[cfg(feature = "local-labs")]
    pub fn register_lab_local(&mut self, lab_account: AccountId, codehash: String, enc_pubkey: String) {
        self.assert_owner();
        require!(is_hex(&codehash, 64), "codehash must be sha256 hex");
        require!(is_hex(&enc_pubkey, 64), "enc_pubkey must be a 32-byte X25519 key in hex");
        let lab = Lab { codehash: codehash.clone(), enc_pubkey, registered_at: now(), local: true };
        self.labs.insert(lab_account.clone(), lab);
        emit("lab_registered", json!({ "lab_account": lab_account, "codehash": codehash, "local": true }));
    }

    /// Owner-registered Lab running in secure hardware. `codehash` is the CVM's compose hash, which the
    /// quote commits to, and `attestation_sha256` fingerprints the attestation the Lab publishes.
    pub fn register_lab_attested(&mut self, lab_account: AccountId, codehash: String, enc_pubkey: String, attestation_sha256: String) {
        self.assert_owner();
        require!(is_hex(&codehash, 64), "codehash must be sha256 hex");
        require!(is_hex(&enc_pubkey, 64), "enc_pubkey must be a 32-byte X25519 key in hex");
        require!(is_hex(&attestation_sha256, 64), "attestation_sha256 must be sha256 hex");
        let lab = Lab { codehash: codehash.clone(), enc_pubkey, registered_at: now(), local: false };
        self.labs.insert(lab_account.clone(), lab);
        // Its own storage key, so the stored layout of `Lab` doesn't change.
        env::storage_write(&attestation_key(&lab_account), attestation_sha256.as_bytes());
        emit("lab_registered", json!({ "lab_account": lab_account, "codehash": codehash, "local": false, "attestation_sha256": attestation_sha256 }));
    }

    /// The fingerprint of the attestation a Lab was registered with, if it was registered in secure hardware.
    pub fn get_lab_attestation(&self, lab_account: AccountId) -> Option<String> {
        env::storage_read(&attestation_key(&lab_account)).map(|v| String::from_utf8(v).unwrap_or_default())
    }

    pub fn remove_lab(&mut self, lab_account: AccountId) {
        self.assert_owner();
        require!(self.labs.remove(&lab_account).is_some(), "lab not registered");
        env::storage_remove(&attestation_key(&lab_account));
        emit("lab_removed", json!({ "lab_account": lab_account }));
    }

    pub fn get_lab(&self, lab_account: AccountId) -> Option<&Lab> {
        self.labs.get(&lab_account)
    }

    pub fn list_labs(&self) -> Vec<(AccountId, Lab)> {
        self.labs.iter().map(|(a, l)| (a.clone(), l.clone())).collect()
    }

    pub fn is_codehash_approved(&self, codehash: String) -> bool {
        self.approved_codehashes.contains(&codehash)
    }
}

fn attestation_key(lab_account: &AccountId) -> Vec<u8> {
    let mut k = b"__tee/".to_vec();
    k.extend_from_slice(lab_account.as_bytes());
    k
}

impl Contract {
    pub(crate) fn assert_lab(&self, account: &AccountId) -> Lab {
        let lab = self.labs.get(account).cloned().unwrap_or_else(|| env::panic_str("caller is not a registered Lab"));
        require!(self.approved_codehashes.contains(&lab.codehash), "Lab codehash is not approved");
        lab
    }
}
