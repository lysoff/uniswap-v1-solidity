const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { ethers } = require("hardhat");

const eth = ethers.utils.parseEther;

const INITIAL_ETH = eth("10000"); //1*10**24
const DEADLINE = 1742680400;
const ETH_RESERVE = eth("5");
const HAY_RESERVE = eth("10");
const DEN_RESERVE = eth("20");

const ONE_ETHER = eth("1");
const TWO_ETHER = eth("2");

describe("UniswapExchangeV1: Liquidity pool", function () {
  it.only("adds and removes liquidity", async function () {
    const [signer0, signer1, signer2] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("ERC20Test");
    const HAY_token = await tokenFactory.deploy("Hay token", "HAY", ethers.constants.MaxUint256);
    const DEN_token = await tokenFactory.deploy("Den token", "DEN", ethers.constants.MaxUint256);

    const uniswapExchangeFactory = await ethers.getContractFactory("UniswapExchangeV1");
    const uniswapFactoryFactory = await ethers.getContractFactory("UniswapFactoryV1");
    const uniswapFactory = await uniswapFactoryFactory.deploy();

    let tx = await uniswapFactory.createExchange(HAY_token.address);
    let receipt = await tx.wait();
    expect(await uniswapFactory.tokenCount()).to.be.eq(1);
    const [HAY_tokenAddr, HAY_exchangeAddr] = receipt.events.find((e) => e.event === "NewExchange")?.args;

    const HAY_exchange = await uniswapExchangeFactory.attach(HAY_exchangeAddr);

    tx = await uniswapFactory.createExchange(DEN_token.address);
    receipt = await tx.wait();
    expect(await uniswapFactory.tokenCount()).to.be.eq(2);
    const [DEN_tokenAddr, DEN_exchangeAddr] = receipt.events.find((e) => e.event === "NewExchange")?.args;

    const DEN_exchange = await uniswapExchangeFactory.attach(DEN_exchangeAddr);

    // First liquidity provider (signer0) adds liquidity
    await HAY_token.approve(HAY_exchangeAddr, HAY_RESERVE);
    await HAY_exchange.addLiquidity(0, HAY_RESERVE, DEADLINE, { value: ETH_RESERVE });
    await HAY_token.transfer(signer1.address, eth("15"));
    await HAY_token.connect(signer1).approve(HAY_exchange.address, eth("15"));

    expect(await HAY_exchange.totalSupply()).to.be.eq(ETH_RESERVE);
    expect(await HAY_exchange.balanceOf(signer0.address)).to.be.eq(ETH_RESERVE);

    expect(await ethers.provider.getBalance(HAY_exchangeAddr)).to.be.eq(ETH_RESERVE);
    expect(await HAY_token.balanceOf(HAY_exchangeAddr)).to.be.eq(HAY_RESERVE);

    await DEN_token.approve(DEN_exchangeAddr, DEN_RESERVE);
    await DEN_exchange.addLiquidity(0, DEN_RESERVE, DEADLINE, { value: ETH_RESERVE });

    expect(await ethers.provider.getBalance(DEN_exchangeAddr)).to.be.eq(ETH_RESERVE);
    expect(await DEN_token.balanceOf(DEN_exchangeAddr)).to.be.eq(DEN_RESERVE);

    await HAY_token.connect(signer1).approve(HAY_exchangeAddr, eth("15"));

    const ETH_ADDED = eth("2.5"); // 25 * 10 ** 17;
    const HAY_ADDED = eth("5"); // 5 * 10 ** 18;

    // minLiquidity == 0 (while totalSupply > 0)
    expect(HAY_exchange.connect(signer1).addLiquidity(0, eth("15"), DEADLINE, { value: ETH_ADDED })).to.be.reverted;

    // maxTokens < tokens needed
    expect(HAY_exchange.connect(signer1).addLiquidity(1, HAY_ADDED - 1, DEADLINE, { value: ETH_ADDED })).to.be.reverted;

    // _deadline < block.timestamp
    expect(HAY_exchange.connect(signer1).addLiquidity(1, eth("15"), 1, { value: ETH_ADDED })).to.be.reverted;

    // Second liquidity provider (a1) adds liquidity
    await HAY_exchange.connect(signer1).addLiquidity(1, eth("15"), DEADLINE, { value: ETH_ADDED });
    expect(await HAY_exchange.totalSupply()).to.be.eq(ETH_RESERVE.add(ETH_ADDED));
    expect(await HAY_exchange.balanceOf(signer0.address)).to.be.eq(ETH_RESERVE);
    expect(await HAY_exchange.balanceOf(signer1.address)).to.be.eq(ETH_ADDED);
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_ADDED));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_ADDED.add(BigNumber.from(1))));

    // Can't transfer more liquidity than owned
    expect(HAY_exchange.connect(signer1).transfer(signer2, ETH_ADDED.add(BigNumber.from(1))));
    // Second liquidity provider (signer1) transfers liquidity to third liquidity provider (signer2)
    await HAY_exchange.connect(signer1).transfer(signer2.address, ONE_ETHER);

    expect(await HAY_exchange.balanceOf(signer0.address)).to.be.eq(ETH_RESERVE);
    expect(await HAY_exchange.balanceOf(signer1.address)).to.be.eq(ETH_ADDED.sub(ONE_ETHER));
    expect(await HAY_exchange.balanceOf(signer2.address)).to.be.eq(ONE_ETHER);
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(ETH_RESERVE.add(ETH_ADDED));
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(HAY_RESERVE.add(HAY_ADDED).add(BigNumber.from(1)));

    // amount == 0
    expect(HAY_exchange.connect(signer2).removeLiquidity(0, 1, 1, DEADLINE)).to.be.reverted;

    // amount > owned (liquidity)
    expect(HAY_exchange.connect(signer2).removeLiquidity(ONE_ETHER.add(BigNumber.from(1)), 1, 1, DEADLINE)).to.be
      .reverted;

    // min eth > eth divested
    expect(HAY_exchange.connect(signer2).removeLiquidity(ONE_ETHER, ONE_ETHER.add(BigNumber.from(1)), 1, DEADLINE)).to
      .be.reverted;

    // min tokens > tokens divested
    expect(HAY_exchange.connect(signer2).removeLiquidity(ONE_ETHER, 1, TWO_ETHER.add(BigNumber.from(1)), DEADLINE)).to
      .be.reverted;

    // deadline < block.timestamp
    expect(HAY_exchange.removeLiquidity(ONE_ETHER, 1, 1, 1)).to.be.reverted;

    // First, second and third liquidity providers remove their remaining liquidity
    await HAY_exchange.removeLiquidity(ETH_RESERVE, 1, 1, DEADLINE);
    await HAY_exchange.connect(signer1).removeLiquidity(ETH_ADDED.sub(ONE_ETHER), 1, 1, DEADLINE);
    await HAY_exchange.connect(signer2).removeLiquidity(ONE_ETHER, 1, 1, DEADLINE);

    expect(await HAY_exchange.totalSupply()).to.be.eq(0);
    expect(await HAY_exchange.balanceOf(signer0.address)).to.be.eq(0);
    expect(await HAY_exchange.balanceOf(signer1.address)).to.be.eq(0);
    expect(await HAY_exchange.balanceOf(signer2.address)).to.be.eq(0);
    expect(await HAY_token.balanceOf(signer1.address)).to.be.eq(eth("13").sub(BigNumber.from(1))); //13*10**18 - 1
    expect(await HAY_token.balanceOf(signer2.address)).to.be.eq(TWO_ETHER.add(1));
    expect(await ethers.provider.getBalance(HAY_exchange.address)).to.be.eq(0);
    expect(await HAY_token.balanceOf(HAY_exchange.address)).to.be.eq(0);

    // Can add liquidity again after all liquidity is divested
    await HAY_token.approve(HAY_exchange.address, eth("100"));
    await HAY_exchange.addLiquidity(0, HAY_RESERVE, DEADLINE, { value: ETH_RESERVE });
  });
});
