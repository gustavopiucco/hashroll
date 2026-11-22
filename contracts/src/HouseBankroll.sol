// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HouseBankroll — the "house" treasury
/// @notice Hybrid model (section 1 of the architecture):
///   1. Player calls `deposit` → `Deposited` event → backend credits the off-chain balance.
///   2. Bets run off-chain (Provably Fair) against that balance.
///   3. To withdraw, the backend debits the balance and signs an EIP-712 voucher;
///      the player calls `withdraw` with the voucher and receives the tokens.
/// @dev Sequential per-player nonce + deadline + EIP-712 domain (chainId + address) prevent replay.
contract HouseBankroll is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address player,uint256 amount,uint256 nonce,uint256 deadline)");

    IERC20 public immutable token;
    address public signer;
    /// @notice Maximum allowed payout = contract balance * maxPayoutBps / 10000 (read by the backend).
    uint16 public maxPayoutBps = 100; // 1% of the bankroll per round

    mapping(address => uint256) public withdrawalNonce;

    event Deposited(address indexed player, uint256 amount);
    event Withdrawn(address indexed player, uint256 amount, uint256 nonce);
    event HouseFunded(address indexed from, uint256 amount);
    event HouseDefunded(address indexed to, uint256 amount);
    event SignerUpdated(address indexed signer);
    event MaxPayoutBpsUpdated(uint16 bps);

    error ZeroAmount();
    error Expired();
    error BadNonce();
    error BadSignature();
    error InvalidBps();
    error ZeroAddress();

    constructor(IERC20 token_, address signer_, address owner_)
        EIP712("HashrollBankroll", "1")
        Ownable(owner_)
    {
        if (address(token_) == address(0) || signer_ == address(0)) revert ZeroAddress();
        token = token_;
        signer = signer_;
    }

    // ------------------------------------------------------------------- player

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert Expired();
        if (nonce != withdrawalNonce[msg.sender]) revert BadNonce();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(WITHDRAWAL_TYPEHASH, msg.sender, amount, nonce, deadline))
        );
        if (ECDSA.recover(digest, signature) != signer) revert BadSignature();

        withdrawalNonce[msg.sender] = nonce + 1; // effects before interaction (CEI)
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, nonce);
    }

    // -------------------------------------------------------------------- views

    function bankroll() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function maxPayout() external view returns (uint256) {
        return (bankroll() * maxPayoutBps) / 10_000;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // -------------------------------------------------------------------- admin

    function fundHouse(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit HouseFunded(msg.sender, amount);
    }

    /// @dev WARNING: the contract does not distinguish house balance from player balances (which live off-chain).
    ///      In production, prefer a timelock/multisig as owner, plus proof of reserves.
    function defundHouse(address to, uint256 amount) external onlyOwner nonReentrant {
        token.safeTransfer(to, amount);
        emit HouseDefunded(to, amount);
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerUpdated(signer_);
    }

    function setMaxPayoutBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 1_000) revert InvalidBps(); // at most 10% per round
        maxPayoutBps = bps;
        emit MaxPayoutBpsUpdated(bps);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
