//! Community notes and conflict-of-interest declarations. They sit under their own storage keys
//! rather than a field on `Contract`, so adding them keeps the stored layout and needs no migration.
//!
//! Notes are only ever shown to people. Nothing in the market lifecycle reads them, so they can't
//! move a price or change a verdict. The poster pays for the storage their note uses.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, NearToken, Promise};

use crate::events::emit;
use crate::{Contract, ContractExt};

pub const MAX_NOTE_BYTES: usize = 600;
const MAX_NOTES_PER_CLAIM: u32 = 500;
const MAX_PAGE: u32 = 100;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum NoteKind {
    Note,
    Reply,
    Declare,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NoteRole {
    Author,
    Creator,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Note {
    pub id: u32,
    pub market_id: u64,
    pub account: AccountId,
    pub kind: NoteKind,
    pub text: String,
    pub role: Option<NoteRole>,
    pub parent: Option<u32>,
    pub at: u64,
    pub hidden: bool,
}

fn key(tag: &[u8], market_id: u64, rest: &[u8]) -> Vec<u8> {
    let mut k = b"__notes/".to_vec();
    k.extend_from_slice(tag);
    k.extend_from_slice(&market_id.to_le_bytes());
    k.extend_from_slice(rest);
    k
}

fn read<T: BorshDeserialize>(k: &[u8]) -> Option<T> {
    env::storage_read(k).map(|v| borsh::from_slice(&v).unwrap_or_else(|_| env::panic_str("unreadable note")))
}

fn write<T: BorshSerialize>(k: &[u8], value: &T) {
    env::storage_write(k, &borsh::to_vec(value).unwrap_or_else(|_| env::panic_str("unwritable note")));
}

fn count(market_id: u64) -> u32 {
    read(&key(b"n", market_id, &[])).unwrap_or(0)
}

fn role_of(market_id: u64, account: &AccountId) -> Option<NoteRole> {
    read(&key(b"d", market_id, account.as_bytes()))
}

fn note_at(market_id: u64, id: u32) -> Option<Note> {
    read(&key(b"i", market_id, &id.to_le_bytes()))
}

#[near]
impl Contract {
    /// Posts a note, an author's reply, or a declaration of a connection to the claim.
    /// Attach enough NEAR for the storage used; anything over it comes back.
    #[payable]
    pub fn add_note(&mut self, market_id: u64, kind: NoteKind, text: String, role: Option<NoteRole>, parent: Option<u32>) -> u32 {
        self.assert_not_paused();
        let account = env::predecessor_account_id();
        let creator = self.markets.get(&market_id).unwrap_or_else(|| env::panic_str("unknown market")).creator.clone();
        require!(text.len() <= MAX_NOTE_BYTES, "a note can be at most 600 bytes");
        let text = text.trim().to_string();
        let declared = role_of(market_id, &account);
        let id = count(market_id);
        require!(id < MAX_NOTES_PER_CLAIM, "this claim has reached its limit of notes");
        let before = env::storage_usage();

        match kind {
            NoteKind::Declare => {
                require!(declared.is_none(), "you already declared a connection to this claim");
                let chosen = role.unwrap_or_else(|| env::panic_str("say whether you are an author or the claim's creator"));
                require!(chosen != NoteRole::Creator || account == creator, "only the account that opened this claim can declare itself its creator");
                write(&key(b"d", market_id, account.as_bytes()), &chosen);
            }
            NoteKind::Note => require!(!text.is_empty(), "write something before posting"),
            NoteKind::Reply => {
                require!(!text.is_empty(), "write something before posting");
                require!(declared.is_some(), "declare your connection to this claim before replying");
                let target = parent.and_then(|p| note_at(market_id, p));
                require!(target.is_some_and(|t| t.kind == NoteKind::Note && !t.hidden), "the note you are replying to isn't there");
            }
        }

        let note = Note {
            id,
            market_id,
            account: account.clone(),
            role: if kind == NoteKind::Declare { role } else { declared },
            parent: if kind == NoteKind::Reply { parent } else { None },
            kind,
            text,
            at: env::block_timestamp() / 1_000_000_000,
            hidden: false,
        };
        write(&key(b"i", market_id, &id.to_le_bytes()), &note);
        write(&key(b"n", market_id, &[]), &(id + 1));

        let used = env::storage_usage().saturating_sub(before) as u128 * env::storage_byte_cost().as_yoctonear();
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= used, "attach more NEAR to cover this note's storage");
        if attached > used {
            let _ = Promise::new(account.clone()).transfer(NearToken::from_yoctonear(attached - used));
        }
        emit("note_added", json!({ "market_id": market_id, "id": id, "account": account }));
        id
    }

    /// The owner can hide spam or abuse. The note's text stops being served.
    pub fn hide_note(&mut self, market_id: u64, id: u32) {
        self.assert_owner();
        let mut note = note_at(market_id, id).unwrap_or_else(|| env::panic_str("unknown note"));
        note.hidden = true;
        note.text = String::new();
        write(&key(b"i", market_id, &id.to_le_bytes()), &note);
        emit("note_hidden", json!({ "market_id": market_id, "id": id }));
    }

    /// A claim's notes, oldest first, without hidden ones.
    pub fn get_notes(&self, market_id: u64, from: Option<u32>, limit: Option<u32>) -> Vec<Note> {
        let from = from.unwrap_or(0);
        let end = from.saturating_add(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE)).min(count(market_id));
        (from..end).filter_map(|id| note_at(market_id, id)).filter(|n| !n.hidden).collect()
    }
}
