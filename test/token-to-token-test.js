const { ethers } = require("hardhat");
const { expect } = require("chai");
const { BigNumber } = require("ethers");

const { swapInput, swapOutput } = require("./utils");
const {
  ETH_RESERVE,
  HAY_RESERVE,
  DEN_RESERVE,
  HAY_SOLD,
  MIN_ETH_BOUGHT,
  MIN_DEN_BOUGHT,
  DEN_BOUGHT,
  MAX_HAY_SOLD,
  MAX_ETH_SOLD,
  INITIAL_ETH,
  DEADLINE,
  ZERO_ADDR,
} = require("./constants");

describe("UniswapExchangeV1: Token to Token trades", function () {
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
    // First liquidity provider (signer0) adds liquidity
    await this.DEN_token.approve(this.DEN_exchange.address, DEN_RESERVE);
    await this.DEN_exchange.addLiquidity(0, DEN_RESERVE, DEADLINE, { value: ETH_RESERVE });
  });

  it("processes token to token swap input", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const { HAY_token, HAY_exchange, DEN_token, DEN_exchange } = this;

    const ETH_PURCHASED = swapInput(HAY_SOLD, HAY_RESERVE, ETH_RESERVE);
    const DEN_PURCHASED = swapInput(ETH_PURCHASED, ETH_RESERVE, DEN_RESERVE);

    // Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, HAY_SOLD);
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(HAY_SOLD);

    // tokens sold == 0
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(0, MIN_DEN_BOUGHT, MIN_ETH_BOUGHT, DEADLINE, DEN_token.address)
    ).to.be.reverted;

    // min tokens bought == 0
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(HAY_SOLD, 0, MIN_ETH_BOUGHT, DEADLINE, DEN_token.address)
    ).to.be.reverted;

    // min tokens bought > tokens bought
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(
        HAY_SOLD,
        DEN_PURCHASED.add(1),
        MIN_ETH_BOUGHT,
        DEADLINE,
        DEN_token.address
      )
    ).to.be.reverted;

    // min eth bought == 0
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(HAY_SOLD, MIN_DEN_BOUGHT, 0, DEADLINE, DEN_token.address)
    ).to.be.reverted;

    // min eth bought > eth bought
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(
        HAY_SOLD,
        MIN_DEN_BOUGHT,
        ETH_PURCHASED.add(1),
        DEADLINE,
        DEN_token.address
      )
    ).to.be.reverted;

    // deadline < block.timestamp
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(HAY_SOLD, MIN_DEN_BOUGHT, MIN_ETH_BOUGHT, 1, DEN_token.address)
    ).to.be.reverted;

    // output token == input token
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(
        HAY_SOLD,
        MIN_DEN_BOUGHT,
        MIN_ETH_BOUGHT,
        DEADLINE,
        HAY_token.address
      )
    ).to.be.reverted;

    // output token == input exchange
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(
        HAY_SOLD,
        MIN_DEN_BOUGHT,
        MIN_ETH_BOUGHT,
        DEADLINE,
        HAY_exchange.address
      )
    ).to.be.reverted;

    // output token == ZERO_ADDR
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapInput(HAY_SOLD, MIN_DEN_BOUGHT, MIN_ETH_BOUGHT, DEADLINE, ZERO_ADDR)
    ).to.be.reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);

    // BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToTokenSwapInput(
      HAY_SOLD,
      MIN_DEN_BOUGHT,
      MIN_ETH_BOUGHT,
      DEADLINE,
      DEN_token.address
    );

    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_PURCHASED));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_SOLD));
    // Updated balances of SWAP exchange
    expect(await ethers.provider.getBalance(DEN_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_PURCHASED));
    expect(await DEN_token.balanceOf(DEN_exchange.address)).to.be.eq(DEN_RESERVE.sub(DEN_PURCHASED));

    // Updated balances of BUYER
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await DEN_token.balanceOf(a1.address)).to.be.eq(DEN_PURCHASED);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
  });

  it("processes token to token transfer input", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const { HAY_token, HAY_exchange, DEN_token, DEN_exchange } = this;

    const ETH_PURCHASED = swapInput(HAY_SOLD, HAY_RESERVE, ETH_RESERVE);
    const DEN_PURCHASED = swapInput(ETH_PURCHASED, ETH_RESERVE, DEN_RESERVE);

    // Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, HAY_SOLD);
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(HAY_SOLD);

    // recipient == ZERO_ADDR
    await expect(
      HAY_exchange.connect(a1).tokenToTokenTransferInput(
        HAY_SOLD,
        MIN_DEN_BOUGHT,
        MIN_ETH_BOUGHT,
        DEADLINE,
        ZERO_ADDR,
        DEN_token.address
      )
    ).to.be.reverted;

    // recipient == output exchange
    await expect(
      HAY_exchange.connect(a1).tokenToTokenTransferInput(
        HAY_SOLD,
        MIN_DEN_BOUGHT,
        MIN_ETH_BOUGHT,
        DEADLINE,
        DEN_exchange.address,
        DEN_token.address
      )
    ).to.be.reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);
    const INITIAL_ETH_2 = await ethers.provider.getBalance(a2.address);

    // BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToTokenTransferInput(
      HAY_SOLD,
      MIN_DEN_BOUGHT,
      MIN_ETH_BOUGHT,
      DEADLINE,
      a2.address,
      DEN_token.address
    );
    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_PURCHASED));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_SOLD));

    // Updated balances of SWAP exchange
    expect(await ethers.provider.getBalance(DEN_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_PURCHASED));
    expect(await DEN_token.balanceOf(DEN_exchange.address)).to.be.eq(DEN_RESERVE.sub(DEN_PURCHASED));

    // Updated balances of BUYER
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await DEN_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );

    // Updated balances of RECIPIENT
    expect(await HAY_token.balanceOf(a2.address)).to.be.eq(0);
    expect(await DEN_token.balanceOf(a2.address)).to.be.eq(DEN_PURCHASED);
    expect(await ethers.provider.getBalance(a2.address)).to.be.eq(INITIAL_ETH_2);
  });

  it("processes token to token swap output", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const { HAY_token, HAY_exchange, DEN_token, DEN_exchange } = this;

    // how much ETH should i pay to get DEN_BOUGHT
    const ETH_COST = swapOutput(DEN_BOUGHT, ETH_RESERVE, DEN_RESERVE);
    // how much HAY should i pay to get ETH_COST
    const HAY_COST = swapOutput(ETH_COST, HAY_RESERVE, ETH_RESERVE);

    // Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, MAX_HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, MAX_HAY_SOLD);
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD);

    // tokens bought == 0
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapOutput(0, MAX_HAY_SOLD, MAX_ETH_SOLD, DEADLINE, DEN_token.address)
    ).to.be.reverted;

    // max tokens < token cost
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapOutput(
        DEN_BOUGHT,
        HAY_COST.sub(1),
        MAX_ETH_SOLD,
        DEADLINE,
        DEN_token.address
      )
    ).to.be.reverted;

    // max eth < token cost
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapOutput(
        DEN_BOUGHT,
        MAX_HAY_SOLD,
        ETH_COST.sub(1),
        DEADLINE,
        DEN_token.address
      )
    ).to.be.reverted;

    // deadline < block.timestamp
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapOutput(DEN_BOUGHT, MAX_HAY_SOLD, MAX_ETH_SOLD, 1, DEN_token.address)
    ).to.be.reverted;

    // output token == input token
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapOutput(
        DEN_BOUGHT,
        MAX_HAY_SOLD,
        MAX_ETH_SOLD,
        DEADLINE,
        HAY_token.address
      )
    ).to.be.reverted;

    // output token == input exchange
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapOutput(
        DEN_BOUGHT,
        MAX_HAY_SOLD,
        MAX_ETH_SOLD,
        DEADLINE,
        HAY_exchange.address
      )
    ).to.be.reverted;

    // output token == ZERO_ADDR
    await expect(
      HAY_exchange.connect(a1).tokenToTokenSwapOutput(DEN_BOUGHT, MAX_HAY_SOLD, MAX_ETH_SOLD, DEADLINE, ZERO_ADDR)
    ).to.be.reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);

    // BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToTokenSwapOutput(
      DEN_BOUGHT,
      MAX_HAY_SOLD,
      MAX_ETH_SOLD,
      DEADLINE,
      DEN_token.address
    );

    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_COST));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_COST));

    // Updated balances of SWAP exchange
    expect(await ethers.provider.getBalance(DEN_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_COST));
    expect(await DEN_token.balanceOf(DEN_exchange.address)).to.be.eq(DEN_RESERVE.sub(DEN_BOUGHT));

    // Updated balances of BUYER
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD.sub(HAY_COST));
    expect(await DEN_token.balanceOf(a1.address)).to.be.eq(DEN_BOUGHT);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );
  });

  it("processes token to token transfer output", async function () {
    const [a0, a1, a2] = await ethers.getSigners();

    const { HAY_token, HAY_exchange, DEN_token, DEN_exchange } = this;

    // how much ETH should i pay to get DEN_BOUGHT
    const ETH_COST = swapOutput(DEN_BOUGHT, ETH_RESERVE, DEN_RESERVE);
    // how much HAY should i pay to get ETH_COST
    const HAY_COST = swapOutput(ETH_COST, HAY_RESERVE, ETH_RESERVE);

    // Transfer HAY to BUYER
    await HAY_token.transfer(a1.address, MAX_HAY_SOLD);
    await HAY_token.connect(a1).approve(HAY_exchange.address, MAX_HAY_SOLD);
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD);

    // recipient == ZERO_ADDR
    await expect(
      HAY_exchange.connect(a1).tokenToTokenTransferOutput(
        DEN_BOUGHT,
        MAX_HAY_SOLD,
        MAX_ETH_SOLD,
        DEADLINE,
        ZERO_ADDR,
        DEN_token.address
      )
    ).to.be.reverted;

    // recipient == output exchange
    await expect(
      HAY_exchange.connect(a1).tokenToTokenTransferOutput(
        DEN_BOUGHT,
        MAX_HAY_SOLD,
        MAX_ETH_SOLD,
        DEADLINE,
        DEN_exchange.address,
        DEN_token.address
      )
    ).to.be.reverted;

    const INITIAL_ETH = await ethers.provider.getBalance(a1.address);
    const INITIAL_ETH_2 = await ethers.provider.getBalance(a2.address);

    // BUYER converts ETH to UNI
    const tx = await HAY_exchange.connect(a1).tokenToTokenTransferOutput(
      DEN_BOUGHT,
      MAX_HAY_SOLD,
      MAX_ETH_SOLD,
      DEADLINE,
      a2.address,
      DEN_token.address
    );

    // gas used
    const { cumulativeGasUsed, effectiveGasPrice } = await tx.wait();

    // Updated balances of UNI exchange
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.sub(ETH_COST));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_COST));

    // Updated balances of SWAP exchange
    expect(await ethers.provider.getBalance(DEN_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_COST));
    expect(await DEN_token.balanceOf(DEN_exchange.address)).to.be.eq(DEN_RESERVE.sub(DEN_BOUGHT));

    // Updated balances of BUYER
    expect(await HAY_token.balanceOf(a1.address)).to.be.eq(MAX_HAY_SOLD.sub(HAY_COST));
    expect(await DEN_token.balanceOf(a1.address)).to.be.eq(0);
    expect(await ethers.provider.getBalance(a1.address)).to.be.eq(
      INITIAL_ETH.sub(cumulativeGasUsed.mul(effectiveGasPrice))
    );

    // Updated balances of RECIPIENT
    expect(await HAY_token.balanceOf(a2.address)).to.be.eq(0);
    expect(await DEN_token.balanceOf(a2.address)).to.be.eq(DEN_BOUGHT);
    expect(await ethers.provider.getBalance(a2.address)).to.be.eq(INITIAL_ETH_2);
  });
});
