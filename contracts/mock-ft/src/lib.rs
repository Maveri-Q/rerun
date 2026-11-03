//! tUSDC: a testnet-only NEP-141 token used as RERUN's money-mode collateral.
//! Anyone registered can mint up to `MAX_MINT` per call. Never deploy this to mainnet.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

pub const DECIMALS: u8 = 6;
/// 10,000 tUSDC per faucet call.
pub const MAX_MINT: u128 = 10_000 * 1_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self { token: FungibleToken::new(StorageKey::Token) }
    }

    /// Testnet faucet: mints to the caller (or `account_id`), which must be registered.
    pub fn mint(&mut self, amount: U128, account_id: Option<AccountId>) {
        require!(amount.0 > 0 && amount.0 <= MAX_MINT, "amount must be 1..=10000 tUSDC");
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        self.token.internal_deposit(&account, amount.0);
        FtMint { owner_id: &account, amount, memo: Some("faucet") }.emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC (RERUN testnet)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(who.parse().unwrap()).attached_deposit(deposit);
        testing_env!(b.build());
    }

    #[test]
    fn faucet_mints_to_registered_accounts() {
        ctx("alice.testnet", NearToken::from_millinear(10));
        let mut c = Contract::new();
        c.storage_deposit(None, None);
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        c.mint(U128(MAX_MINT), None);
        assert_eq!(c.ft_balance_of("alice.testnet".parse().unwrap()).0, MAX_MINT);
        assert_eq!(c.ft_metadata().decimals, 6);
    }

    #[test]
    #[should_panic(expected = "amount must be")]
    fn faucet_is_capped() {
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        let mut c = Contract::new();
        c.mint(U128(MAX_MINT + 1), None);
    }

    #[test]
    #[should_panic]
    fn unregistered_accounts_cannot_receive() {
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        let mut c = Contract::new();
        c.mint(U128(1), None);
    }
}
