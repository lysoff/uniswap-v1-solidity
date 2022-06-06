const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");

const eth = ethers.utils.parseEther;

module.exports.ZERO_ADDR = ethers.constants.AddressZero;
// Passing deadline
module.exports.DEADLINE = 1742680400; // deadline = w3.eth.getBlock(w3.eth.blockNumber).timestamp
// INITIAL RESERVE SIZE
module.exports.ETH_RESERVE = eth("5");
module.exports.HAY_RESERVE = eth("10");
module.exports.DEN_RESERVE = eth("20");
// ETH to ERC20 swap input
module.exports.ETH_SOLD = eth("1");
module.exports.MIN_HAY_BOUGHT = 1;
// ETH to ERC20 swap output
module.exports.HAY_BOUGHT = BigNumber.from("1662497915624478906");
module.exports.MAX_ETH_SOLD = eth("2");
// ERC20 to ETH swap input
module.exports.HAY_SOLD = eth("2");
module.exports.MIN_ETH_BOUGHT = 1;
// ERC20 to ETH swap output
module.exports.ETH_BOUGHT = BigNumber.from("831248957812239453");
module.exports.MAX_HAY_SOLD = eth("3");
// ERC20 to ERC20
module.exports.MIN_DEN_BOUGHT = 1;
module.exports.DEN_BOUGHT = BigNumber.from("2843678215834080602");
