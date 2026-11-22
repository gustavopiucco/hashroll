// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {HashrollToken} from "../src/HashrollToken.sol";
import {HouseBankroll} from "../src/HouseBankroll.sol";

/// Usage (local/Anvil): forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $DEPLOYER_PK
contract Deploy is Script {
    function run() external {
        address deployer = msg.sender;
        address signer = vm.envAddress("SIGNER_ADDRESS");
        vm.startBroadcast();
        HashrollToken token = new HashrollToken(deployer, 1_000_000_000 ether);
        HouseBankroll bank = new HouseBankroll(token, signer, deployer);
        token.approve(address(bank), 100_000_000 ether);
        bank.fundHouse(100_000_000 ether);
        vm.stopBroadcast();
        console.log("HashrollToken:", address(token));
        console.log("HouseBankroll:", address(bank));
    }
}
