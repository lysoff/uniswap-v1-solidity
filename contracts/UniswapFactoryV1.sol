// SPDX-License-Identifier: Unlicensed
pragma solidity 0.8.13;

import "@openzeppelin/contracts/proxy/Clones.sol";

interface Exchange {
  function setup(address _tokenAddr) external;
}

contract UniswapFactoryV1 {
  event NewExchange(address indexed token, address indexed exchange);

  address public exchangeTemplate;
  uint256 public tokenCount;

  mapping(address => address) private tokenToExchange;
  mapping(address => address) private exchangeToToken;
  mapping(address => uint256) private idToToken;

  function initializeFactory(address _template) public {
    require(exchangeTemplate == address(0));
    require(_template != address(0));
    exchangeTemplate = _template;
  }

  function createExchange(address _token) public returns (address) {
   require(_token != address(0));
   require(exchangeTemplate != address(0));

   address clone = Clones.clone(exchangeTemplate);
   Exchange(clone).setup(_token);

   tokenToExchange[_token] = clone;
   exchangeToToken[clone] = _token;

   uint tokenId = tokenCount + 1;
   tokenCount = tokenId;

   idToToken[tokenId] = _token;

   emit NewExchange(_token, clone);
   return clone;
  }

 function getExchange(address _token) public view returns (address) {
  return tokenToExchange[_token];
 }

 function getExchange(address _exchange) public view returns (address) {
  return exchangeToToken[_exchange];
 }

 function getExchange(uint _tokenId) public view returns (address) {
  return idToToken[_tokenId];
 } 

}