// SPDX-License-Identifier: Unlicensed
pragma solidity 0.8.13;

import "./UniswapExchangeV1.sol";

contract UniswapFactoryV1 {
  event NewExchange(address indexed token, address indexed exchange);

  uint256 public tokenCount;

  mapping(address => address) private tokenToExchange;
  mapping(address => address) private exchangeToToken;
  mapping(uint => address) private idToToken;

  function createExchange(address _tokenAddr) public returns (address) {
    require(_tokenAddr != address(0), "Invalid token address");

    UniswapExchangeV1 exchange = new UniswapExchangeV1(_tokenAddr);
    address exchangeAddr = address(exchange);

    tokenToExchange[_tokenAddr] = exchangeAddr;
    exchangeToToken[exchangeAddr] = _tokenAddr;

    uint tokenId = tokenCount + 1;
    tokenCount = tokenId;

    idToToken[tokenId] = _tokenAddr;

    emit NewExchange(_tokenAddr, exchangeAddr);
    return exchangeAddr;
  }

  function getExchange(address _tokenAddr) public view returns (address) {
    return tokenToExchange[_tokenAddr];
  }

  function getToken(address _exchangeAddr) public view returns (address) {
    return exchangeToToken[_exchangeAddr];
  }

  function getTokenWithId(uint _tokenId) public view returns (address) {
    return idToToken[_tokenId];
  } 

}