// SPDX-License-Identifier: Unlicensed
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/presets/ERC20PresetFixedSupply.sol";

contract ERC20Test is ERC20PresetFixedSupply {
  constructor(string memory name, string memory symbol, uint initialSupply)
   ERC20PresetFixedSupply(name, symbol, initialSupply, msg.sender)
   {}
}