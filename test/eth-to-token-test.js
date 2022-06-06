const { ethers } = require("hardhat");
const { expect } = require("chai");
const { BigNumber } = require("ethers");

const { swapInput, swapOutput } = require("./utils");
const {
  ETH_RESERVE,
  HAY_RESERVE,
  ETH_SOLD,
  MIN_HAY_BOUGHT,
  HAY_BOUGHT,
  MAX_ETH_SOLD,
  DEADLINE,
  ZERO_ADDR,
} = require("./constants");

describe("UniswapExchangeV1: ETH to token trades", function () {
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

  it("processes default swap", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const HAY_PURCHASED = swapInput(ETH_SOLD, ETH_RESERVE, HAY_RESERVE);

    // msg.value == 0
    await expect(
      a1.sendTransaction({
        to: this.HAY_exchange.address,
        value: 0,
      })
    ).to.be.reverted;

    // consider current balance to be initial
    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);

    // BUYER converts ETH to UNI
    const tx = await a1.sendTransaction({
      to: this.HAY_exchange.address,
      value: ETH_SOLD,
    });

    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(this.HAY_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_SOLD));
    expect(await this.HAY_token.balanceOf(this.HAY_exchange.address)).to.be.eq(HAY_RESERVE.sub(HAY_PURCHASED));

    // Updated balances of BUYER
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(ETH_SOLD).sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
    expect(await this.HAY_token.balanceOf(a1.address)).to.be.eq(HAY_PURCHASED);
  });

  it("processes swap input", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const HAY_PURCHASED = swapInput(ETH_SOLD, ETH_RESERVE, HAY_RESERVE);
    expect(await this.HAY_exchange.getEthToTokenInputPrice(ETH_SOLD)).to.be.eq(HAY_PURCHASED);
    // eth sold == 0
    await expect(this.HAY_exchange.connect(a1).ethToTokenSwapInput(MIN_HAY_BOUGHT, DEADLINE, { value: 0 })).to.be
      .reverted;
    // min tokens == 0
    await expect(this.HAY_exchange.connect(a1).ethToTokenSwapInput(0, DEADLINE, { value: ETH_SOLD })).to.be.reverted;
    // min tokens > tokens purchased
    await expect(this.HAY_exchange.connect(a1).ethToTokenSwapInput(HAY_PURCHASED.add(1), DEADLINE, { value: ETH_SOLD }))
      .to.be.reverted;
    // deadline < block.timestamp
    await expect(this.HAY_exchange.connect(a1).ethToTokenSwapInput(MIN_HAY_BOUGHT, 1, { value: ETH_SOLD })).to.be
      .reverted;

    // consider current balance - gas used on reverted txs as initial
    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);

    // BUYER converts ETH to UNI
    const tx = await this.HAY_exchange.connect(a1).ethToTokenSwapInput(MIN_HAY_BOUGHT, DEADLINE, { value: ETH_SOLD });

    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(this.HAY_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_SOLD));
    expect(await this.HAY_token.balanceOf(this.HAY_exchange.address)).to.be.eq(HAY_RESERVE.sub(HAY_PURCHASED));

    // Updated balances of BUYER
    expect(await this.HAY_token.balanceOf(a1.address)).to.be.eq(HAY_PURCHASED);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(ETH_SOLD).sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
  });

  it("processes transfer input", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    // a0, a1, a2 = w3.eth.accounts[:3]
    const HAY_PURCHASED = swapInput(ETH_SOLD, ETH_RESERVE, HAY_RESERVE);
    // recipient == ZERO_ADDR
    await expect(
      this.HAY_exchange.connect(a1).ethToTokenTransferInput(MIN_HAY_BOUGHT, DEADLINE, ZERO_ADDR, { value: ETH_SOLD })
    ).to.be.reverted;
    // recipient == exchange
    await expect(
      this.HAY_exchange.connect(a1).ethToTokenTransferInput(MIN_HAY_BOUGHT, DEADLINE, this.HAY_exchange.address, {
        value: ETH_SOLD,
      })
    ).to.be.reverted;

    // consider current balance - gas used on reverted txs as initial
    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);
    const INITIAL_ETH_2 = await ethers.provider.getBalance(a2.address);

    // BUYER converts ETH to UNI
    const tx = await this.HAY_exchange.connect(a1).ethToTokenTransferInput(MIN_HAY_BOUGHT, DEADLINE, a2.address, {
      value: ETH_SOLD,
    });
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(this.HAY_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_SOLD));
    expect(await this.HAY_token.balanceOf(this.HAY_exchange.address)).to.be.eq(HAY_RESERVE.sub(HAY_PURCHASED));

    // Updated balances of BUYER
    expect(await this.HAY_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(ETH_SOLD).sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
    // Updated balances of RECIPIENT
    expect(await this.HAY_token.balanceOf(a2.address)).to.be.eq(HAY_PURCHASED);
    expect(await ethers.provider.getBalance(a2.address)).to.be.eq(INITIAL_ETH_2);
  });

  it("processes swap output", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const ETH_COST = swapOutput(HAY_BOUGHT, ETH_RESERVE, HAY_RESERVE);
    expect(await this.HAY_exchange.getEthToTokenOutputPrice(HAY_BOUGHT)).to.be.eq(ETH_COST);
    // max eth < ETH_COST
    await expect(this.HAY_exchange.connect(a1).ethToTokenSwapOutput(0, DEADLINE, { value: MAX_ETH_SOLD })).to.be
      .reverted;
    // tokens bought == 0
    await expect(this.HAY_exchange.connect(a1).ethToTokenSwapOutput(0, DEADLINE, { value: MAX_ETH_SOLD })).to.be
      .reverted;
    // deadline < block.timestamp
    await expect(this.HAY_exchange.connect(a1).ethToTokenSwapOutput(HAY_BOUGHT, 1, { value: MAX_ETH_SOLD })).to.be
      .reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);

    // BUYER converts ETH to UNI
    const tx = await this.HAY_exchange.connect(a1).ethToTokenSwapOutput(HAY_BOUGHT, DEADLINE, { value: MAX_ETH_SOLD });
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(this.HAY_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_COST));
    expect(await this.HAY_token.balanceOf(this.HAY_exchange.address)).to.be.eq(HAY_RESERVE.sub(HAY_BOUGHT));
    // Updated balances of BUYER
    expect(await this.HAY_token.balanceOf(a1.address)).to.be.eq(HAY_BOUGHT);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(ETH_COST).sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
  });

  it("processes transfer output", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const ETH_COST = swapOutput(HAY_BOUGHT, ETH_RESERVE, HAY_RESERVE);

    // recipient == ZERO_ADDR
    await expect(
      this.HAY_exchange.connect(a1).ethToTokenTransferOutput(HAY_BOUGHT, DEADLINE, ZERO_ADDR, {
        value: MAX_ETH_SOLD,
      })
    ).to.be.reverted;

    // recipient == exchange
    await expect(
      this.HAY_exchange.connect(a1).ethToTokenTransferOutput(HAY_BOUGHT, DEADLINE, this.HAY_exchange.address, {
        value: MAX_ETH_SOLD,
      })
    ).to.be.reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);
    const INITIAL_ETH_2 = await ethers.provider.getBalance(a2.address);

    // BUYER converts ETH to UNI
    const tx = await this.HAY_exchange.connect(a1).ethToTokenTransferOutput(HAY_BOUGHT, DEADLINE, a2.address, {
      value: MAX_ETH_SOLD,
    });
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(this.HAY_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_COST));
    expect(await this.HAY_token.balanceOf(this.HAY_exchange.address)).to.be.eq(HAY_RESERVE.sub(HAY_BOUGHT));

    // Updated balances of BUYER
    // assert HAY_token.balanceOf(a1) == 0
    // assert w3.eth.getBalance(a1) == INITIAL_ETH - ETH_COST
    expect(await this.HAY_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(ETH_COST).sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );

    // Updated balances of RECIPIENT
    expect(await this.HAY_token.balanceOf(a2.address)).to.be.eq(HAY_BOUGHT);
    expect(await ethers.provider.getBalance(a2.address)).to.be.eq(INITIAL_ETH_2);
  });
});
