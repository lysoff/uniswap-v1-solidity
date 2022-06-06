const { ethers } = require("hardhat");
const { expect } = require("chai");
const { BigNumber } = require("ethers");

const { swapInput, swapOutput } = require("./utils");
const {
  ETH_RESERVE,
  HAY_RESERVE,
  HAY_SOLD,
  MIN_ETH_BOUGHT,
  ETH_BOUGHT,
  MAX_HAY_SOLD,
  DEADLINE,
} = require("./constants");

describe("UniswapExchangeV1: Token to ETH trades", function () {
  beforeEach(async function () {
    const tokenFactory = await ethers.getContractFactory("ERC20Test");

    this.HAY_token = await tokenFactory.deploy("Hay token", "HAY", ethers.constants.MaxUint256);
    this.DEN_token = await tokenFactory.deploy("Den token", "DEN", ethers.constants.MaxUint256);

    const uniswapExchangeFactory = await ethers.getContractFactory("UniswapExchangeV1");
    const uniswapFactoryFactory = await ethers.getContractFactory("UniswapFactoryV1");
    const uniswapFactory = await uniswapFactoryFactory.deploy();

    let tx = await uniswapFactory.createExchange(this.HAY_token.address);
    let receipt = await tx.wait();
    expect(await uniswapFactory.tokenCount()).to.be.eq(1);
    const [, HAY_exchangeAddr] = receipt.events.find((e) => e.event === "NewExchange")?.args;

    this.HAY_exchange = await uniswapExchangeFactory.attach(HAY_exchangeAddr);

    tx = await uniswapFactory.createExchange(this.DEN_token.address);
    receipt = await tx.wait();
    expect(await uniswapFactory.tokenCount()).to.be.eq(2);
    const [, DEN_exchangeAddr] = receipt.events.find((e) => e.event === "NewExchange")?.args;

    this.DEN_exchange = await uniswapExchangeFactory.attach(DEN_exchangeAddr);

    // First liquidity provider (signer0) adds liquidity
    await this.HAY_token.approve(this.HAY_exchange.address, HAY_RESERVE);
    await this.HAY_exchange.addLiquidity(0, HAY_RESERVE, DEADLINE, { value: ETH_RESERVE });
  });

  it("processes token to ETH swap input", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const { HAY_token, HAY_exchange } = this;

    const ETH_PURCHASED = swapInput(HAY_SOLD, HAY_RESERVE, ETH_RESERVE);
    // Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, HAY_SOLD);
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(HAY_SOLD);
    // tokens sold == 0
    await expect(HAY_exchange.connect(a1).tokenToEthSwapInput(0, MIN_ETH_BOUGHT, DEADLINE)).to.be.reverted;
    // min eth == 0
    await expect(HAY_exchange.connect(a1).tokenToEthSwapInput(HAY_SOLD, 0, DEADLINE)).to.be.reverted;
    // min eth > eth purchased
    await expect(HAY_exchange.connect(a1).tokenToEthSwapInput(HAY_SOLD, ETH_PURCHASED.add(1), DEADLINE)).to.be.reverted;
    // deadline < block.timestamp
    await expect(HAY_exchange.connect(a1).tokenToEthSwapInput(HAY_SOLD, MIN_ETH_BOUGHT, 1)).to.be.reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);

    // BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToEthSwapInput(HAY_SOLD, MIN_ETH_BOUGHT, DEADLINE);
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_PURCHASED));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_SOLD));

    // Updated balances of BUYER
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.add(ETH_PURCHASED).sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
  });

  it("process Token to ETH transfer input", async function () {
    const [a0, a1, a2] = await ethers.getSigners();
    const { HAY_token, HAY_exchange } = this;
    const ETH_PURCHASED = swapInput(HAY_SOLD, HAY_RESERVE, ETH_RESERVE);
    // Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, HAY_SOLD);

    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(HAY_SOLD);
    // recipient == ZERO_ADDR
    await expect(HAY_exchange.connect(a1).tokenToEthTransferInput(HAY_SOLD, 1, DEADLINE, ZERO_ADDR)).to.be.reverted;
    // recipient == exchange
    await expect(HAY_exchange.connect(a1).tokenToEthTransferInput(HAY_SOLD, 1, DEADLINE, HAY_exchange.address)).to.be
      .reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);
    const INITIAL_ETH_2 = await ethers.provider.getBalance(a2.address);

    // BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToEthTransferInput(HAY_SOLD, 1, DEADLINE, a2.address);
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_PURCHASED));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_SOLD));
    // Updated balances of BUYER
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
    // Updated balances of RECIPIENT
    expect(await HAY_token.balanceOf(a2.address)).to.be.eq(0);
    expect(await ethers.provider.getBalance(a2.address)).to.be.eq(INITIAL_ETH_2.add(ETH_PURCHASED));
  });

  it("processes token to ETH swap output", async function () {
    const [a0, a1, a2] = await ethers.getSigners();
    const { HAY_token, HAY_exchange } = this;
    const HAY_COST = swapOutput(ETH_BOUGHT, HAY_RESERVE, ETH_RESERVE);

    // Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, MAX_HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, MAX_HAY_SOLD);

    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD);
    // tokens bought == 0
    await expect(HAY_exchange.connect(a1).tokenToEthSwapOutput(0, MAX_HAY_SOLD, DEADLINE)).to.be.reverted;
    // max tokens < token cost
    await expect(HAY_exchange.connect(a1).tokenToEthSwapOutput(ETH_BOUGHT, HAY_COST - 1, DEADLINE)).to.be.reverted;
    // deadline < block.timestamp
    await expect(HAY_exchange.connect(a1).tokenToEthSwapOutput(ETH_BOUGHT, MAX_HAY_SOLD, 1)).to.be.reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);

    // BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToEthSwapOutput(ETH_BOUGHT, MAX_HAY_SOLD, DEADLINE);
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();
    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_BOUGHT));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_COST));
    // Updated balances of BUYER
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.add(ETH_BOUGHT).sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD.sub(HAY_COST));
  });

  it("processes token to ETH transfer output", async function () {
    const [a0, a1, a2] = await ethers.getSigners();
    const { HAY_token, HAY_exchange } = this;
    const HAY_COST = swapOutput(ETH_BOUGHT, HAY_RESERVE, ETH_RESERVE);

    //  Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, MAX_HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, MAX_HAY_SOLD);

    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD);
    //  recipient == ZERO_ADDR
    await expect(HAY_exchange.connect(a1).tokenToEthTransferOutput(ETH_BOUGHT, MAX_HAY_SOLD, DEADLINE, ZERO_ADDR)).to.be
      .reverted;
    //  recipient == exchange
    await expect(HAY_exchange.tokenToEthTransferOutput(ETH_BOUGHT, MAX_HAY_SOLD, DEADLINE, HAY_exchange.address)).to.be
      .reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);
    const INITIAL_ETH_2 = await ethers.provider.getBalance(a2.address);

    //  BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToEthTransferOutput(ETH_BOUGHT, MAX_HAY_SOLD, DEADLINE, a2.address);
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    //  Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_BOUGHT));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_COST));
    //  Updated balances of BUYER
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD.sub(HAY_COST));
    //  Updated balances of RECIPIENT
    expect(await ethers.provider.getBalance(a2.address)).to.be.eq(INITIAL_ETH_2.add(ETH_BOUGHT));
    expect(await HAY_token.balanceOf(a2.address)).to.be.eq(0);
  });
});
