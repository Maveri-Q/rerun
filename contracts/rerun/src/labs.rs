//! Lab registry. A Lab may act only while registered *and* its codehash is approved, so
//! revoking a codehash blocks its proposals immediately.
//!
//! TEE registration (`register_agent` with attestation verification, after NEAR's Shade
//! Agent reference contract) arrives with the Phala deployment. Until then the owner can
//! register a Lab locally, and only in builds with the `local-labs` feature.

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

    pub fn remove_lab(&mut self, lab_account: AccountId) {
        self.assert_owner();
        require!(self.labs.remove(&lab_account).is_some(), "lab not registered");
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

impl Contract {
    pub(crate) fn assert_lab(&self, account: &AccountId) -> Lab {
        let lab = self.labs.get(account).cloned().unwrap_or_else(|| env::panic_str("caller is not a registered Lab"));
        require!(self.approved_codehashes.contains(&lab.codehash), "Lab codehash is not approved");
        lab
    }
}
