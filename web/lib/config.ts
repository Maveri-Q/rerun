export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || "testnet") as "testnet" | "mainnet";
export const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT || "rerun.rerun-43f5f2.testnet";
export const FT = process.env.NEXT_PUBLIC_FT || "tusdc.rerun-43f5f2.testnet";
export const RPC = process.env.NEXT_PUBLIC_RPC || "https://test.rpc.fastnear.com";
/** Empty on the hosted site until a Lab is online there, so visitors' browsers never try their own computer. */
export const LAB_URL = (process.env.NEXT_PUBLIC_LAB_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:8787")).replace(/\/$/, "");
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

export const accountLink = (id: string) => `${EXPLORER}/address/${id}`;
export const txLink = (hash: string) => `${EXPLORER}/txns/${hash}`;
/** On mainnet the money is real. Copy that calls it a test token, and the free test tokens, depend on this. */
export const REAL_MONEY = NETWORK === "mainnet";
