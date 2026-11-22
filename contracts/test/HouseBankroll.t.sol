// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {HashrollToken} from "../src/HashrollToken.sol";
import {HouseBankroll} from "../src/HouseBankroll.sol";

contract HouseBankrollTest is Test {
    HashrollToken token;
    HouseBankroll bank;
    uint256 signerPk = 0xA11CE;
    address signer;
    address owner = makeAddr("owner");
    address player = makeAddr("player");

    function setUp() public {
        signer = vm.addr(signerPk);
        token = new HashrollToken(owner, 1_000_000 ether);
        bank = new HouseBankroll(token, signer, owner);
        vm.startPrank(owner);
        token.approve(address(bank), type(uint256).max);
        bank.fundHouse(100_000 ether);
        token.transfer(player, 1_000 ether);
        vm.stopPrank();
        vm.prank(player);
        token.approve(address(bank), type(uint256).max);
    }

    function _sign(address p, uint256 amount, uint256 nonce, uint256 deadline, uint256 pk)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(bank.WITHDRAWAL_TYPEHASH(), p, amount, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", bank.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_DepositEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit HouseBankroll.Deposited(player, 100 ether);
        vm.prank(player);
        bank.deposit(100 ether);
        assertEq(bank.bankroll(), 100_100 ether);
    }

    function test_WithdrawWithValidVoucher() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(player, 50 ether, 0, deadline, signerPk);
        vm.prank(player);
        bank.withdraw(50 ether, 0, deadline, sig);
        assertEq(token.balanceOf(player), 1_050 ether);
        assertEq(bank.withdrawalNonce(player), 1);
    }

    function test_RevertReplay() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(player, 50 ether, 0, deadline, signerPk);
        vm.startPrank(player);
        bank.withdraw(50 ether, 0, deadline, sig);
        vm.expectRevert(HouseBankroll.BadNonce.selector);
        bank.withdraw(50 ether, 0, deadline, sig);
        vm.stopPrank();
    }

    function test_RevertExpired() public {
        uint256 deadline = block.timestamp + 1;
        bytes memory sig = _sign(player, 50 ether, 0, deadline, signerPk);
        vm.warp(deadline + 1);
        vm.prank(player);
        vm.expectRevert(HouseBankroll.Expired.selector);
        bank.withdraw(50 ether, 0, deadline, sig);
    }

    function test_RevertWrongSigner() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(player, 50 ether, 0, deadline, 0xBAD);
        vm.prank(player);
        vm.expectRevert(HouseBankroll.BadSignature.selector);
        bank.withdraw(50 ether, 0, deadline, sig);
    }

    function test_RevertVoucherUsedByOtherAccount() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(player, 50 ether, 0, deadline, signerPk);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(HouseBankroll.BadSignature.selector);
        bank.withdraw(50 ether, 0, deadline, sig);
    }

    function test_RevertWhenPaused() public {
        vm.prank(owner);
        bank.pause();
        vm.prank(player);
        vm.expectRevert();
        bank.deposit(1 ether);
    }

    function test_OnlyOwnerAdmin() public {
        vm.prank(player);
        vm.expectRevert();
        bank.defundHouse(player, 1 ether);
    }

    function test_MaxPayoutIsProportional() public view {
        assertEq(bank.maxPayout(), 1_000 ether); // 1% of 100k
    }

    function testFuzz_DepositWithdrawRoundTrip(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1_000 ether));
        vm.prank(player);
        bank.deposit(amount);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(player, amount, 0, deadline, signerPk);
        vm.prank(player);
        bank.withdraw(amount, 0, deadline, sig);
        assertEq(token.balanceOf(player), 1_000 ether);
    }
}
