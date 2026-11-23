/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/hashroll.json`.
 */
export type Hashroll = {
  "address": "D6s76Umz4mQUoy9ySiU3vtb9cjWnHuGUBuBwmgbvwxxQ",
  "metadata": {
    "name": "hashroll",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Hashroll: provably fair on-chain dice"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "docs": [
        "Two-step admin transfer (step 2), signed by the proposed admin."
      ],
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "newAdmin",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimExpired",
      "docs": [
        "The house missed the settlement deadline: the player receives the full potential payout.",
        "The commitment is cleared because its seed was never revealed; the house must commit again."
      ],
      "discriminator": [
        124,
        78,
        197,
        187,
        210,
        66,
        255,
        1
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true,
          "relations": [
            "playerState"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "commitSeed",
      "docs": [
        "Sets the commitment for the next bet. Only allowed while no bet is pending, so the",
        "house can never swap the seed after seeing a client seed."
      ],
      "discriminator": [
        115,
        4,
        240,
        226,
        140,
        33,
        78,
        75
      ],
      "accounts": [
        {
          "name": "house",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player_state.player",
                "account": "playerState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "commitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "defundHouse",
      "docs": [
        "Withdraws house liquidity. Funds reserved for pending bets can never be withdrawn."
      ],
      "discriminator": [
        212,
        100,
        243,
        27,
        30,
        28,
        163,
        28
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "to",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundHouse",
      "docs": [
        "Anyone can add liquidity to the house bankroll."
      ],
      "discriminator": [
        175,
        231,
        49,
        44,
        144,
        102,
        41,
        69
      ],
      "accounts": [
        {
          "name": "funder",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "funderToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the config and the vault. Only the program's upgrade authority can call it,",
        "so nobody can front-run the deploy and take over the admin role."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "D6s76Umz4mQUoy9ySiU3vtb9cjWnHuGUBuBwmgbvwxxQ"
        },
        {
          "name": "programData"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "house",
          "type": "pubkey"
        },
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "openPlayer",
      "docs": [
        "Creates a player's account with the first commitment. The house pays the rent."
      ],
      "discriminator": [
        82,
        252,
        144,
        191,
        80,
        197,
        87,
        157
      ],
      "accounts": [
        {
          "name": "house",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "player"
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "commitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "placeDice",
      "docs": [
        "Dice: wins if the roll (0..9999) is under `target` (or at least 10000 - target for `Over`).",
        "`expected_commitment` must match the stored one, so the bet fails instead of silently using",
        "another seed. The same holds for every `place_*` instruction."
      ],
      "discriminator": [
        241,
        186,
        143,
        178,
        147,
        92,
        146,
        187
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true,
          "relations": [
            "playerState"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "target",
          "type": "u16"
        },
        {
          "name": "direction",
          "type": {
            "defined": {
              "name": "direction"
            }
          }
        },
        {
          "name": "clientSeed",
          "type": "string"
        },
        {
          "name": "expectedCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "placePlinko",
      "docs": [
        "Plinko: `rows` bounces (8, 12 or 16), one bit of the digest each; the slot is the number of",
        "right bounces and pays the multiplier of the fixed table for `rows` and `risk`."
      ],
      "discriminator": [
        84,
        226,
        82,
        4,
        29,
        111,
        210,
        127
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true,
          "relations": [
            "playerState"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "rows",
          "type": "u8"
        },
        {
          "name": "risk",
          "type": {
            "defined": {
              "name": "plinkoRisk"
            }
          }
        },
        {
          "name": "clientSeed",
          "type": "string"
        },
        {
          "name": "expectedCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "placeRoulette",
      "docs": [
        "European roulette: up to 8 chips, each covering a set of numbers (37-bit mask) and paying",
        "amount * 36 / covered. The stake is the sum of the chips; the reserve is the best case",
        "over the 37 numbers."
      ],
      "discriminator": [
        217,
        157,
        145,
        11,
        84,
        23,
        78,
        70
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true,
          "relations": [
            "playerState"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "chips",
          "type": {
            "vec": {
              "defined": {
                "name": "rouletteChip"
              }
            }
          }
        },
        {
          "name": "clientSeed",
          "type": "string"
        },
        {
          "name": "expectedCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "placeSlots",
      "docs": [
        "Slots: a 3x3 grid, one digest byte per cell, with 5 paylines (3 rows, 2 diagonals). Three of",
        "a kind pay the symbol's multiple of the line bet (stake / 5), wilds count as any symbol and a",
        "board showing a single symbol pays 10x. The reserve is the 1000x of nine wilds."
      ],
      "discriminator": [
        47,
        230,
        251,
        157,
        213,
        211,
        82,
        62
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true,
          "relations": [
            "playerState"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "clientSeed",
          "type": "string"
        },
        {
          "name": "expectedCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "proposeAdmin",
      "docs": [
        "Two-step admin transfer (step 1). Pass the default pubkey to cancel."
      ],
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setHouse",
      "discriminator": [
        61,
        250,
        53,
        80,
        30,
        151,
        135,
        165
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "house",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setParams",
      "discriminator": [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "configParams"
            }
          }
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Pausing blocks new bets only. Settlements and expiry claims keep working so funds are never stuck."
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleBet",
      "docs": [
        "Reveals the server seed of the pending bet, resolves it and commits the next seed."
      ],
      "discriminator": [
        115,
        55,
        234,
        177,
        227,
        4,
        10,
        67
      ],
      "accounts": [
        {
          "name": "house",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player_state.player",
                "account": "playerState"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "playerToken",
          "docs": [
            "Optional: without it a payout is credited to `owed` (see `settle_bet`)."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "serverSeed",
          "type": "string"
        },
        {
          "name": "nextCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "withdrawOwed",
      "docs": [
        "Withdraws payouts that were credited because the player's token account was missing at settlement."
      ],
      "discriminator": [
        110,
        222,
        234,
        254,
        112,
        86,
        192,
        66
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true,
          "relations": [
            "playerState"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "playerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "config"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "playerState",
      "discriminator": [
        56,
        3,
        60,
        86,
        174,
        16,
        244,
        195
      ]
    }
  ],
  "events": [
    {
      "name": "adminUpdated",
      "discriminator": [
        69,
        82,
        49,
        171,
        43,
        3,
        80,
        161
      ]
    },
    {
      "name": "betExpired",
      "discriminator": [
        43,
        67,
        162,
        239,
        216,
        73,
        136,
        104
      ]
    },
    {
      "name": "betPlaced",
      "discriminator": [
        88,
        88,
        145,
        226,
        126,
        206,
        32,
        0
      ]
    },
    {
      "name": "betSettled",
      "discriminator": [
        57,
        145,
        224,
        160,
        62,
        119,
        227,
        206
      ]
    },
    {
      "name": "houseDefunded",
      "discriminator": [
        195,
        196,
        190,
        113,
        180,
        189,
        174,
        224
      ]
    },
    {
      "name": "houseFunded",
      "discriminator": [
        153,
        127,
        126,
        162,
        239,
        83,
        35,
        120
      ]
    },
    {
      "name": "houseUpdated",
      "discriminator": [
        229,
        106,
        130,
        177,
        75,
        74,
        50,
        59
      ]
    },
    {
      "name": "owedWithdrawn",
      "discriminator": [
        5,
        182,
        86,
        222,
        137,
        212,
        104,
        229
      ]
    },
    {
      "name": "paramsUpdated",
      "discriminator": [
        2,
        163,
        138,
        99,
        135,
        11,
        136,
        169
      ]
    },
    {
      "name": "pausedUpdated",
      "discriminator": [
        209,
        89,
        200,
        35,
        126,
        183,
        132,
        23
      ]
    },
    {
      "name": "seedCommitted",
      "discriminator": [
        224,
        239,
        12,
        205,
        163,
        28,
        63,
        9
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "zeroAddress",
      "msg": "Address cannot be the default pubkey"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Signer is not authorized"
    },
    {
      "code": 6003,
      "name": "invalidParams",
      "msg": "Invalid config parameters"
    },
    {
      "code": 6004,
      "name": "paused",
      "msg": "Betting is paused"
    },
    {
      "code": 6005,
      "name": "betPending",
      "msg": "The player already has a pending bet"
    },
    {
      "code": 6006,
      "name": "noPendingBet",
      "msg": "The player has no pending bet"
    },
    {
      "code": 6007,
      "name": "noCommitment",
      "msg": "No server seed commitment: the house must commit first"
    },
    {
      "code": 6008,
      "name": "commitmentMismatch",
      "msg": "The commitment changed: refresh and try again"
    },
    {
      "code": 6009,
      "name": "invalidTarget",
      "msg": "Target must be between 100 and 9800"
    },
    {
      "code": 6010,
      "name": "invalidClientSeed",
      "msg": "Client seed must have 1 to 32 bytes and no ':'"
    },
    {
      "code": 6011,
      "name": "profitTooHigh",
      "msg": "Potential profit exceeds the bankroll limit"
    },
    {
      "code": 6012,
      "name": "badServerSeed",
      "msg": "Server seed does not match the commitment"
    },
    {
      "code": 6013,
      "name": "notExpired",
      "msg": "The settlement deadline has not passed yet"
    },
    {
      "code": 6014,
      "name": "insufficientBankroll",
      "msg": "Not enough free bankroll"
    },
    {
      "code": 6015,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6016,
      "name": "invalidPlinko",
      "msg": "Plinko rows must be 8, 12 or 16"
    },
    {
      "code": 6017,
      "name": "invalidRouletteBet",
      "msg": "Roulette: 1 to 8 chips, each with an amount and a mask of 1 to 36 numbers (0-36)"
    },
    {
      "code": 6018,
      "name": "nothingOwed",
      "msg": "Nothing to withdraw"
    }
  ],
  "types": [
    {
      "name": "adminUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "betExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "betPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "clientSeed",
            "type": "string"
          },
          {
            "name": "game",
            "type": {
              "defined": {
                "name": "game"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "u16"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "rows",
            "type": "u8"
          },
          {
            "name": "risk",
            "type": {
              "defined": {
                "name": "plinkoRisk"
              }
            }
          },
          {
            "name": "chips",
            "type": {
              "vec": {
                "defined": {
                  "name": "rouletteChip"
                }
              }
            }
          },
          {
            "name": "maxPayout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "betSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "serverSeed",
            "type": "string"
          },
          {
            "name": "clientSeed",
            "type": "string"
          },
          {
            "name": "game",
            "type": {
              "defined": {
                "name": "game"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "u16"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "rows",
            "type": "u8"
          },
          {
            "name": "risk",
            "type": {
              "defined": {
                "name": "plinkoRisk"
              }
            }
          },
          {
            "name": "chips",
            "type": {
              "vec": {
                "defined": {
                  "name": "rouletteChip"
                }
              }
            }
          },
          {
            "name": "outcome",
            "docs": [
              "Dice roll (0..9999), Plinko path bits (bit i = row i, 1 = right), Roulette number (0..36)",
              "or Slots grid (cell i in bits 3i..3i+2)."
            ],
            "type": "u32"
          },
          {
            "name": "payout",
            "docs": [
              "Gross payout (0 on a loss; Plinko and Slots can pay less than the stake)."
            ],
            "type": "u64"
          },
          {
            "name": "credited",
            "docs": [
              "True when the payout went to `owed` because the player's token account was missing."
            ],
            "type": "bool"
          },
          {
            "name": "nextCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "house",
            "docs": [
              "Settler key: opens player accounts, commits and reveals server seeds."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "houseEdgeBps",
            "type": "u16"
          },
          {
            "name": "maxPayoutBps",
            "docs": [
              "Maximum profit per bet = free bankroll * max_payout_bps / 10000."
            ],
            "type": "u16"
          },
          {
            "name": "settleTimeoutSecs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "reserved",
            "docs": [
              "Sum of the potential payouts of all pending bets (always covered by the vault)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "houseEdgeBps",
            "type": "u16"
          },
          {
            "name": "maxPayoutBps",
            "type": "u16"
          },
          {
            "name": "settleTimeoutSecs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "direction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "under"
          },
          {
            "name": "over"
          }
        ]
      }
    },
    {
      "name": "game",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "dice"
          },
          {
            "name": "plinko"
          },
          {
            "name": "roulette"
          },
          {
            "name": "slots"
          }
        ]
      }
    },
    {
      "name": "houseDefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "houseFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "houseUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "house",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "owedWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "paramsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "houseEdgeBps",
            "type": "u16"
          },
          {
            "name": "maxPayoutBps",
            "type": "u16"
          },
          {
            "name": "settleTimeoutSecs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pausedUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "playerState",
      "docs": [
        "Field order matters: the API filters pending bets with a memcmp on `pending`",
        "(offset 8 discriminator + 32 player + 8 nonce + 32 commitment = 80)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "docs": [
              "Nonce of the next (or pending) bet. Increments once per resolved bet."
            ],
            "type": "u64"
          },
          {
            "name": "commitment",
            "docs": [
              "SHA256(serverSeed) for the next (or pending) bet. All zeros = the house must commit."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "pending",
            "type": "bool"
          },
          {
            "name": "betGame",
            "type": {
              "defined": {
                "name": "game"
              }
            }
          },
          {
            "name": "betAmount",
            "docs": [
              "Total stake (for Roulette, the sum of the chips)."
            ],
            "type": "u64"
          },
          {
            "name": "betTarget",
            "docs": [
              "Dice only."
            ],
            "type": "u16"
          },
          {
            "name": "betDirection",
            "docs": [
              "Dice only."
            ],
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "betRows",
            "docs": [
              "Plinko only."
            ],
            "type": "u8"
          },
          {
            "name": "betRisk",
            "docs": [
              "Plinko only."
            ],
            "type": {
              "defined": {
                "name": "plinkoRisk"
              }
            }
          },
          {
            "name": "betChips",
            "docs": [
              "Roulette only."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "rouletteChip"
                }
              }
            }
          },
          {
            "name": "betMaxPayout",
            "docs": [
              "Best-case payout, reserved against the vault and paid in full by `claim_expired`."
            ],
            "type": "u64"
          },
          {
            "name": "betPlacedAt",
            "type": "i64"
          },
          {
            "name": "betClientSeed",
            "type": "string"
          },
          {
            "name": "owed",
            "docs": [
              "Payouts credited when the player's token account was missing at settlement (still reserved)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "plinkoRisk",
      "docs": [
        "Index into the Plinko tables of `fair.rs` (low = 0, medium = 1, high = 2)."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "low"
          },
          {
            "name": "medium"
          },
          {
            "name": "high"
          }
        ]
      }
    },
    {
      "name": "rouletteChip",
      "docs": [
        "One roulette chip: covers the numbers set in `mask` (bit i = number i)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mask",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "seedCommitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};
