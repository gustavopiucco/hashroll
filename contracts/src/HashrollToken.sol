// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title HROLL — official currency of the Hashroll ecosystem
/// @notice Fixed supply minted at deploy. No later minting (predictable tokenomics).
contract HashrollToken is ERC20, ERC20Permit {
    constructor(address treasury, uint256 initialSupply) ERC20("Hashroll", "HROLL") ERC20Permit("Hashroll") {
        _mint(treasury, initialSupply);
    }
}
