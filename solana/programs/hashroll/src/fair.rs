//! Provably Fair: on-chain port of `packages/fair`. Both MUST produce identical results.
//!
//!   commitment = SHA256(serverSeed)
//!   digest     = HMAC_SHA256(key = serverSeed, msg = clientSeed + ":" + nonce)
//!   n          = first 4 bytes of digest as big-endian u32
//!   roll       = floor(n * 10000 / 2^32)            -> 0..9999   (Dice)
//!   number     = floor(n * 37 / 2^32)               -> 0..36     (Roulette)
//!   path       = bit i of the digest, MSB-first     -> 1 = right (Plinko, one bit per row)
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

/* ------------------------------------------------------------ Plinko */

pub const PLINKO_RISK_COUNT: usize = 3; // low, medium, high

/// Multipliers in basis points, indexed by slot. Identical to PLINKO_TABLES in `packages/fair`.
/// The house edge is built in (RTP 98.75%-98.97%); `house_edge_bps` does not apply.
pub const PLINKO_8: [[u32; 9]; PLINKO_RISK_COUNT] = [
    [56000, 27100, 13800, 7700, 5000, 7700, 13800, 27100, 56000],
    [130000, 37100, 13100, 5900, 4000, 5900, 13100, 37100, 130000],
    [290000, 49200, 11100, 3600, 2000, 3600, 11100, 49200, 290000],
];
pub const PLINKO_12: [[u32; 13]; PLINKO_RISK_COUNT] = [
    [100000, 55500, 31500, 18400, 11100, 7000, 5000, 7000, 11100, 18400, 31500, 55500, 100000],
    [330000, 127000, 51500, 21900, 9900, 4900, 3000, 4900, 9900, 21900, 51500, 127000, 330000],
    [1700000, 308000, 67900, 18400, 6300, 2900, 2000, 2900, 6300, 18400, 67900, 308000, 1700000],
];
pub const PLINKO_16: [[u32; 17]; PLINKO_RISK_COUNT] = [
    [160000, 96800, 59300, 36800, 23200, 14900, 9800, 6700, 5000, 6700, 9800, 14900, 23200, 36800, 59300, 96800, 160000],
    [1100000, 424000, 171000, 72200, 32100, 15200, 7700, 4300, 3000, 4300, 7700, 15200, 32100, 72200, 171000, 424000, 1100000],
    [10000000, 1840000, 397000, 100000, 29800, 10700, 4700, 2600, 2000, 2600, 4700, 10700, 29800, 100000, 397000, 1840000, 10000000],
];

/// `risk`: 0 = low, 1 = medium, 2 = high. `None` for unsupported rows.
pub fn plinko_table(rows: u8, risk: usize) -> Option<&'static [u32]> {
    if risk >= PLINKO_RISK_COUNT {
        return None;
    }
    match rows {
        8 => Some(&PLINKO_8[risk]),
        12 => Some(&PLINKO_12[risk]),
        16 => Some(&PLINKO_16[risk]),
        _ => None,
    }
}

/// Path bits (bit i = direction of row i, 1 = right), read MSB-first from the digest.
pub fn digest_to_plinko_path(digest: &[u8; 32], rows: u8) -> u32 {
    let mut bits = 0u32;
    for i in 0..rows as usize {
        let bit = (digest[i / 8] >> (7 - (i % 8))) & 1;
        bits |= (bit as u32) << i;
    }
    bits
}

pub fn plinko_payout(amount: u64, table: &[u32], slot: usize) -> Option<u64> {
    let p = (amount as u128) * (*table.get(slot)? as u128) / BPS as u128;
    u64::try_from(p).ok()
}

/* ---------------------------------------------------------- Roulette */

pub const ROULETTE_POCKETS: u64 = 37;
pub const ROULETTE_MAX_CHIPS: usize = 8;
pub const ALL_NUMBERS_MASK: u64 = (1u64 << 37) - 1;

pub fn digest_to_roulette_number(digest: &[u8; 32]) -> u8 {
    let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) as u64;
    ((n * ROULETTE_POCKETS) >> 32) as u8
}

/// A chip covers the numbers set in `mask` (bit i = number i) and pays amount * 36 / covered.
pub fn is_valid_roulette_mask(mask: u64) -> bool {
    mask != 0 && mask & !ALL_NUMBERS_MASK == 0 && mask.count_ones() <= 36
}

pub fn chip_payout(mask: u64, amount: u64, number: u8) -> u64 {
    if (mask >> number) & 1 == 1 {
        // amount * 36 fits in u128; the quotient is at most amount * 36, which may exceed u64 only
        // for absurd stakes that the profit cap rejects anyway (saturate instead of wrapping).
        u64::try_from(amount as u128 * 36 / mask.count_ones() as u128).unwrap_or(u64::MAX)
    } else {
        0
    }
}

/// Total payout of a set of `(mask, amount)` chips if the ball lands on `number`.
pub fn roulette_payout<I: IntoIterator<Item = (u64, u64)>>(chips: I, number: u8) -> u64 {
    chips.into_iter().fold(0u64, |sum, (m, a)| sum.saturating_add(chip_payout(m, a, number)))
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
    fn roulette_and_plinko_vectors_match_the_typescript_spec() {
        let digests: Vec<[u8; 32]> = (0..5).map(|n| compute_digest(SERVER.as_bytes(), CLIENT, n)).collect();
        let numbers: Vec<u8> = digests.iter().map(digest_to_roulette_number).collect();
        let paths: Vec<u32> = digests.iter().map(|d| digest_to_plinko_path(d, 16)).collect();
        assert_eq!(numbers, [27, 26, 17, 12, 29]);
        assert_eq!(paths, [56285, 62381, 42606, 36394, 51859]);
    }

    #[test]
    fn plinko_tables_rtp_below_99_percent() {
        fn binom(n: u128, k: u128) -> u128 {
            (0..k).fold(1u128, |r, i| r * (n - i) / (i + 1))
        }
        for rows in [8u8, 12, 16] {
            for risk in 0..PLINKO_RISK_COUNT {
                let t = plinko_table(rows, risk).unwrap();
                assert_eq!(t.len(), rows as usize + 1);
                let num: u128 = t.iter().enumerate().map(|(k, m)| binom(rows as u128, k as u128) * *m as u128).sum();
                let den = (1u128 << rows) * BPS as u128;
                assert!(num * 1000 < den * 990 && num * 1000 >= den * 985, "rows {rows} risk {risk}");
            }
        }
        assert!(plinko_table(10, 0).is_none() && plinko_table(8, 3).is_none());
    }

    #[test]
    fn roulette_rules() {
        let red: u64 = [1u8, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].iter().fold(0, |m, n| m | 1 << n);
        assert_eq!(chip_payout(1 << 17, 100, 17), 3600);
        assert_eq!(chip_payout(red, 100, 1), 200);
        assert_eq!(chip_payout(red, 100, 0), 0);
        assert_eq!(roulette_payout([(red, 100), (1 << 3, 10)], 3), 560);
        assert!(!is_valid_roulette_mask(0) && !is_valid_roulette_mask(1 << 37) && !is_valid_roulette_mask(ALL_NUMBERS_MASK));
    }

    #[test]
    fn client_seed_rules() {
        assert!(is_valid_client_seed("player-seed"));
        assert!(!is_valid_client_seed(""));
        assert!(!is_valid_client_seed("a:b"));
        assert!(!is_valid_client_seed(&"x".repeat(33)));
    }
}
