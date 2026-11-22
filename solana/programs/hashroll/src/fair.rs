//! Provably Fair: on-chain port of `packages/fair`. Both MUST produce identical results.
//!
//!   commitment = SHA256(serverSeed)
//!   digest     = HMAC_SHA256(key = serverSeed, msg = clientSeed + ":" + nonce)
//!   n          = first 4 bytes of digest as big-endian u32
//!   roll       = floor(n * 10000 / 2^32)            -> 0..9999
//!
//! Seeds are UTF-8 strings (the house uses 64 hex characters); the HMAC key is their UTF-8 bytes.
//! The fixed vectors in `packages/fair/src/index.test.ts` are replayed in the tests below.

use solana_sha256_hasher::hashv;

pub const ROLL_RANGE: u64 = 10_000;
pub const BPS: u64 = 10_000;
pub const MIN_TARGET: u16 = 100; // 1% chance
pub const MAX_TARGET: u16 = 9_800; // 98% chance
pub const MAX_CLIENT_SEED_LEN: usize = 32;
/// HMAC-SHA256 block size. Longer keys would need pre-hashing, so they are simply rejected.
pub const MAX_SERVER_SEED_LEN: usize = 64;

pub fn sha256(data: &[u8]) -> [u8; 32] {
    hashv(&[data]).to_bytes()
}

/// HMAC-SHA256 (RFC 2104) for keys up to one block (64 bytes), built on the sha256 syscall.
pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    assert!(key.len() <= MAX_SERVER_SEED_LEN, "HMAC key longer than one block");
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for (i, b) in key.iter().enumerate() {
        ipad[i] ^= b;
        opad[i] ^= b;
    }
    let inner = hashv(&[&ipad, msg]).to_bytes();
    hashv(&[&opad, &inner]).to_bytes()
}

pub fn is_valid_client_seed(client_seed: &str) -> bool {
    !client_seed.is_empty() && client_seed.len() <= MAX_CLIENT_SEED_LEN && !client_seed.contains(':')
}

pub fn compute_digest(server_seed: &[u8], client_seed: &str, nonce: u64) -> [u8; 32] {
    let msg = format!("{client_seed}:{nonce}");
    hmac_sha256(server_seed, msg.as_bytes())
}

pub fn digest_to_roll(digest: &[u8; 32]) -> u16 {
    let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) as u64;
    ((n * ROLL_RANGE) >> 32) as u16
}

pub fn compute_roll(server_seed: &[u8], client_seed: &str, nonce: u64) -> u16 {
    digest_to_roll(&compute_digest(server_seed, client_seed, nonce))
}

/// under: wins if roll < target | over: wins if roll >= 10000 - target
pub fn is_win(roll: u16, target: u16, over: bool) -> bool {
    if over {
        roll as u64 >= ROLL_RANGE - target as u64
    } else {
        roll < target
    }
}

pub fn is_valid_target(target: u16) -> bool {
    (MIN_TARGET..=MAX_TARGET).contains(&target)
}

/// Gross payout on a win = amount * (10000 - edgeBps) / target. `None` on overflow or invalid input.
pub fn payout_for(amount: u64, target: u16, house_edge_bps: u16) -> Option<u64> {
    if !is_valid_target(target) || house_edge_bps as u64 >= BPS {
        return None;
    }
    let p = (amount as u128) * ((BPS - house_edge_bps as u64) as u128) / (target as u128);
    u64::try_from(p).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER: &str = "hashroll-test-server-seed";
    const CLIENT: &str = "player-seed";
    /// Same vectors as packages/fair/src/index.test.ts. If they change, the specification changed.
    const VECTORS: [u16; 5] = [7338, 7101, 4624, 3298, 7864];

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn fixed_vectors_match_the_typescript_spec() {
        let rolls: Vec<u16> = (0..5).map(|n| compute_roll(SERVER.as_bytes(), CLIENT, n)).collect();
        assert_eq!(rolls, VECTORS);
    }

    #[test]
    fn hmac_matches_rfc4231_case_2() {
        let d = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(hex(&d), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn hmac_with_a_full_block_key() {
        // 64-character hex seed, the format the house uses. Reference: node:crypto createHmac.
        let key = "a".repeat(64);
        let d = compute_digest(key.as_bytes(), "x", 0);
        assert_eq!(hex(&d), "0484e35057886d78f9bd6e518269b7b5a2348a4ad2aef94fd188f282225a1471");
    }

    #[test]
    fn win_rules_and_payout() {
        assert!(is_win(4999, 5000, false) && !is_win(5000, 5000, false));
        assert!(is_win(5000, 5000, true) && !is_win(4999, 5000, true));
        // 50% chance, 1% edge => 1.98x
        assert_eq!(payout_for(1_000_000_000, 5000, 100), Some(1_980_000_000));
        assert_eq!(payout_for(1, 50, 100), None);
        assert_eq!(payout_for(u64::MAX, 100, 0), None);
    }

    #[test]
    fn client_seed_rules() {
        assert!(is_valid_client_seed("player-seed"));
        assert!(!is_valid_client_seed(""));
        assert!(!is_valid_client_seed("a:b"));
        assert!(!is_valid_client_seed(&"x".repeat(33)));
    }
}
