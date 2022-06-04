const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("UniswapFactoryV1", function () {
  it("creates a factory", async function () {
    const uniswapFactoryFactory = await ethers.getContractFactory("UniswapFactoryV1");
    const uniswapExchangeFactory = await ethers.getContractFactory("UniswapExchangeV1");
    const tokenFactory = await ethers.getContractFactory("ERC20");

    const uniswapFactory = await uniswapFactoryFactory.deploy();
    const token = await tokenFactory.deploy("Token", "TKN");

    expect(await uniswapFactory.tokenCount()).to.be.eq(0);

    let tx = uniswapFactory.createExchange(ethers.constants.AddressZero);
    await expect(tx).to.be.revertedWith("Invalid token address");

    tx = await uniswapFactory.createExchange(token.address);
    let receipt = await tx.wait();

    expect(await uniswapFactory.tokenCount()).to.be.eq(1);

    const [tokenAddr, exchangeAddr] = receipt.events.find(e => e.event === "NewExchange")?.args;

    expect(tokenAddr).to.be.eq(token.address);
    expect(ethers.utils.isAddress(exchangeAddr)).to.be.true;

    expect(await uniswapFactory.getExchange(token.address)).to.be.eq(exchangeAddr);
    expect(await uniswapFactory.getToken(exchangeAddr)).to.be.eq(token.address);
    expect(await uniswapFactory.getTokenWithId(1)).to.be.eq(token.address);

    const exchange = await uniswapExchangeFactory.attach(exchangeAddr);
    expect(await exchange.name()).to.be.eq("Uniswap V1");
    expect(await exchange.symbol()).to.be.eq("UNI-V1");
    expect(await exchange.decimals()).to.be.eq(18);
    expect(await exchange.totalSupply()).to.be.eq(0);

    expect(await exchange.tokenAddress()).to.be.eq(token.address);
    expect(await exchange.factoryAddress()).to.be.eq(uniswapFactory.address);

    expect(await token.balanceOf(exchangeAddr)).to.be.eq(0);
    expect(await ethers.provider.getBalance(exchangeAddr)).to.be.eq(0);
  });
});
