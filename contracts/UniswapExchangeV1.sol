// SPDX-License-Identifier: Unlicensed
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface Factory {
 function getExchange(address _tokenAddr) external view returns (address);
}

interface Exchange {
 function getEthToTokenOutputPrice(uint _tokensBought) external view returns(uint);
 function ethToTokenTransferInput(uint _minTokens, uint _deadline, address _recipient)
  external payable returns(uint);
 function ethToTokenTransferOutput(uint _tokensBought, uint _deadline, address _recipient) 
  external payable returns(uint);
}

contract UniswapExchangeV1 is ERC20("Uniswap V1", "UNI-V1") {
  using Address for address payable;

  event TokenPurchase(address indexed _buyer, uint indexed _ethSold, uint indexed _tokensBought);
  event EthPurchase(address indexed _buyer, uint indexed _tokensSold, uint indexed _ethBouht);
  event AddLiquidity(address indexed _provider, uint indexed _ethAmount, uint indexed _tokenAmount);
  event RemoveLiquidity(address indexed _provider, uint indexed _ethAmount, uint indexed _tokenAmount);

  ERC20 private token;
  Factory private factory;

  constructor(address _tokenAddr) {
    require(address(factory) == address(0) && address(token) == address(0) && _tokenAddr != address(0));
    
    factory = Factory(msg.sender);
    token = ERC20(_tokenAddr);
  }

  /// @notice Deposit ETH and Tokens (token) at current ratio to mint UNI tokens.
  /// @dev min_liquidity does nothing when total UNI supply is 0.
  /// @param _minLiquidity Minimum number of UNI sender will mint if total UNI supply is greater than 0.
  /// @param _maxTokens Maximum number of tokens deposited. Deposits max amount if total UNI supply is 0.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @return The amount of UNI minted.
  function addLiquidity(
    uint _minLiquidity, 
    uint _maxTokens, 
    uint _deadline
  ) public payable returns(uint) {
    require(_deadline > block.timestamp && _maxTokens > 0 && msg.value > 0);
    uint totalLiquidity = totalSupply();

    if (totalLiquidity > 0 ) {
      require(_minLiquidity > 0);
      uint ethReserve = address(this).balance - msg.value; 
      uint tokenReserve = token.balanceOf(address(this));

      uint tokenAmount = msg.value * tokenReserve / ethReserve + 1;
      uint liquidityMinted = msg.value * totalLiquidity / ethReserve;

      require(_maxTokens >= tokenAmount && liquidityMinted >= _minLiquidity);
      _mint(msg.sender, liquidityMinted);

      require(token.transferFrom(msg.sender, address(this), tokenAmount));

      emit AddLiquidity(msg.sender, msg.value, tokenAmount);

      return liquidityMinted;
    } else {
      require(address(factory) != address(0) && address(token) != address(0) && msg.value >= 1000000000);
      require(factory.getExchange(address(token)) == address(this));

      uint tokenAmount = _maxTokens; // tokenAmount = 10 DVT
      uint initialLiquidity = address(this).balance; // initialLiquidity = 10 ETH
      // minting liquidity tokens equal to paid ETH
      _mint(msg.sender, initialLiquidity); 

      // transfering exchange token from sender to exchange (must be approved ahead)
      require(token.transferFrom(msg.sender, address(this), tokenAmount));

      emit AddLiquidity(msg.sender, msg.value, tokenAmount);

      return initialLiquidity;
    }
  }

  /// @dev Burn UNI tokens to withdraw ETH and Tokens at current ratio.
  /// @param _amount Amount of UNI burned.
  /// @param _minEth Minimum ETH withdrawn.
  /// @param _minTokens Minimum Tokens withdrawn.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @return The amount of ETH and Tokens withdrawn.
  function removeLiquidity(
    uint _amount, 
    uint _minEth, 
    uint _minTokens, 
    uint _deadline
  ) public returns (uint, uint) {
    require((_amount > 0 && _deadline > block.timestamp)
     && (_minEth > 0 && _minTokens > 0));

    uint totalLiquidity = totalSupply();
    require(totalLiquidity > 0);

    uint tokenReserve = token.balanceOf(address(this));
    uint ethAmount = _amount * address(this).balance / totalLiquidity;
    uint tokenAmount = _amount * tokenReserve / totalLiquidity;

    require(ethAmount >= _minEth && tokenAmount >= _minTokens);

    _burn(msg.sender, _amount);
    payable(msg.sender).sendValue(ethAmount);
    require(token.transfer(msg.sender, tokenAmount));

    emit RemoveLiquidity(msg.sender, ethAmount, tokenAmount);

    return (ethAmount, tokenAmount);
  }


  /// @dev Pricing function for converting between ETH and Tokens.
  /// @notice How much will i get if i pay _inputAmount 
  /// @param _inputAmount Amount of ETH or Tokens being sold.
  /// @param _inputReserve Amount of ETH or Tokens (input type) in exchange reserves. 
  /// @param _outputReserve Amount of ETH or Tokens (output type) in exchange reserves.
  /// @return Amount of ETH or Tokens bought.
  function getInputPrice(
    uint _inputAmount, 
    uint _inputReserve, 
    uint _outputReserve
  ) private pure returns (uint) {
    
    require(_inputReserve > 0 && _outputReserve > 0);

    uint inputAmountWithFee = _inputAmount * 997;
    uint numerator = inputAmountWithFee * _outputReserve;
    uint denominator = (_inputReserve * 1000) + inputAmountWithFee;

    return numerator / denominator;
  }

  /// @dev Pricing function for converting between ETH and Tokens.
  /// @notice How much should i pay to get _outputAmount
  /// @param _outputAmount Amount of ETH or Tokens being bought.
  /// @param _inputReserve Amount of ETH or Tokens (input type) in exchange reserves.
  /// @param _outputReserve Amount of ETH or Tokens (output type) in exchange reserves.
  /// @return Amount of ETH or Tokens sold.
  function getOutputPrice(
    uint _outputAmount, 
    uint _inputReserve, 
    uint _outputReserve
  ) private pure returns (uint) {
    require(_inputReserve > 0 && _outputReserve > 0);

    uint numerator = _inputReserve * _outputAmount * 1000;
    uint denominator = (_outputReserve - _outputAmount) * 997;

    return numerator / denominator + 1;
  }

  /// @dev buy tokens for ETH
  /// @param _ethSold how much eth paid
  /// @param _minTokens minimum desirable amount of tokens (price slip to non-desirable range)
  /// @param _deadline do not execute the trade after
  /// @param _buyer address paid for the trade
  /// @param _recipient address gets the bought tokens
  /// @return Amount of Tokens bought.
  function ethToTokenInput(
    uint _ethSold, 
    uint _minTokens, 
    uint _deadline, 
    address _buyer, 
    address _recipient
  ) private returns (uint) {
    require(_deadline >= block.timestamp && (_ethSold > 0 && _minTokens > 0));

    uint tokenReserve = token.balanceOf(address(this));
    uint tokensBought = getInputPrice(_ethSold, address(this).balance - _ethSold, tokenReserve);

    require(tokensBought >= _minTokens);
    require(token.transfer(_recipient, tokensBought));

    emit TokenPurchase(_buyer, _ethSold, tokensBought);

    return tokensBought;
  }

  /// @notice Convert ETH to Tokens.
  /// @dev User specifies exact input (msg.value).
  /// @dev User cannot specify minimum output or _.
  receive() external payable {
    ethToTokenInput(msg.value, 1, block.timestamp, msg.sender, msg.sender);
  }

  /// @notice Convert ETH to Tokens.
  /// @dev User specifies exact input (msg.value) and minimum output.
  /// @param _minTokens Minimum Tokens bought.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @return Amount of Tokens bought.
  function ethToTokenSwapInput(uint _minTokens, uint _deadline) 
  public payable returns(uint) {
    return ethToTokenInput(msg.value, _minTokens, _deadline, msg.sender, msg.sender);
  }

  /// @notice Convert ETH to Tokens and transfers Tokens to recipient.
  /// @dev User specifies exact input (msg.value) and minimum output
  /// @param _minTokens Minimum Tokens bought.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @param _recipient The address that receives output Tokens.
  /// @return Amount of Tokens bought.
  function ethToTokenTransferInput(
    uint _minTokens, 
    uint _deadline, 
    address _recipient
  ) public payable returns(uint) {
    require(_recipient != address(this) && _recipient != address(0));
    return ethToTokenInput(msg.value, _minTokens, _deadline, msg.sender, _recipient);
  }

  /// @dev converts ETH to Token
  /// @param _tokensBought desirable amount of tokens
  /// @param _maxEth max ETH i would like to spend on that trade
  /// @param _deadline do not execute the trade after
  /// @param _buyer address paid for the trade (it also gets the refund)
  /// @param _recipient address gets the bought tokens
  /// @return Amount of ETH sold.
  function ethToTokenOutput(
    uint _tokensBought, 
    uint _maxEth, 
    uint _deadline, 
    address _buyer, 
    address _recipient
  ) private returns(uint) {
    require(_deadline >= block.timestamp && (_tokensBought > 0 && _maxEth > 0));

    uint tokenReserve = token.balanceOf(address(this));
    uint ethSold = getOutputPrice(_tokensBought, address(this).balance - _maxEth, tokenReserve);

    uint ethRefund = _maxEth - ethSold;
    if (ethRefund > 0) {
      payable(_buyer).sendValue(ethRefund);
    }

    require(token.transfer(_recipient, _tokensBought));

    emit TokenPurchase(_buyer, ethSold, _tokensBought);

    return ethSold;
  }

  /// @notice Convert ETH to Tokens.
  /// @dev User specifies maximum input (msg.value) and exact output.
  /// @param _tokensBought Amount of tokens bought.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @return Amount of ETH sold.
  function ethToTokenSwapOutput(
    uint _tokensBought, 
    uint _deadline
  ) public payable returns (uint) {
    return ethToTokenOutput(_tokensBought, msg.value, _deadline, msg.sender, msg.sender);
  }

  /// @notice Convert ETH to Tokens and transfers Tokens to recipient.
  /// @dev User specifies maximum input (msg.value) and exact output.
  /// @param _tokensBought Amount of tokens bought.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @param _recipient The address that receives output Tokens.
  /// @return Amount of ETH sold.
  function ethToTokenTransferOutput(
    uint _tokensBought, 
    uint _deadline, 
    address _recipient
  ) public payable returns(uint) {
    require(_recipient != address(this) && _recipient != address(0));

    return ethToTokenOutput(_tokensBought, msg.value, _deadline, msg.sender, _recipient);
  }

  /// @dev buy ETH for specified amount of tokens
  /// @param _tokensSold Amount of tokens to buy ETH for
  /// @param _minEth Minimal desirable amount of ETH
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @param _buyer The address pays for the trade
  /// @param _recipient The address that receives output Tokens.
  /// @return Amount of ETH bought.
  function tokenToEthInput(
    uint _tokensSold, 
    uint _minEth, 
    uint _deadline, 
    address _buyer, 
    address _recipient
  ) private returns (uint) {
    require(_deadline >= block.timestamp && (_tokensSold > 0 && _minEth > 0));

    uint tokenReserve = token.balanceOf(address(this));
    uint ethBought = getInputPrice(_tokensSold, tokenReserve, address(this).balance);

    require(ethBought >= _minEth);

    payable(_recipient).sendValue(ethBought);
    require(token.transferFrom(_buyer, address(this), _tokensSold));

    emit EthPurchase(_buyer, _tokensSold, ethBought);
    return ethBought;
  }

  /// @notice Convert Tokens to ETH.
  /// @dev User specifies exact input and minimum output.
  /// @param _tokensSold Amount of Tokens sold.
  /// @param _minEth Minimum ETH purchased.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @return Amount of ETH bought.
  function tokenToEthSwapInput(
    uint _tokensSold, 
    uint _minEth, 
    uint _deadline
  ) public returns (uint) {
    return tokenToEthInput(_tokensSold, _minEth, _deadline, msg.sender, msg.sender);
  }

  /// @notice Convert Tokens to ETH and transfers ETH to recipient.
  /// @dev User specifies exact input and minimum output.
  /// @param _tokensSold Amount of Tokens sold.
  /// @param _minEth Minimum ETH purchased.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @param _recipient The address that receives output ETH.
  /// @return Amount of ETH bought.
  function tokenToEthTransferInput(
    uint _tokensSold, 
    uint _minEth, 
    uint _deadline, 
    address _recipient
  ) public returns(uint) {
    require(_recipient != address(this) && _recipient != address(0));

    return tokenToEthInput(_tokensSold, _minEth, _deadline, msg.sender, _recipient);
  }

  /// @dev buy ETH for tokens
  /// @param _ethBought desirable ETH amount
  /// @param _maxTokens max tokens to spend for the trade
  /// @param _deadline do not execute the trade after
  /// @param _buyer address pays tokens for the trade
  /// @param _recipient address receives bought ETH
  /// @return Amount of tokens sold.
  function tokenToEthOutput(
    uint _ethBought, 
    uint _maxTokens, 
    uint _deadline,
    address _buyer,
    address _recipient
   ) private returns (uint) {
     require(_deadline >= block.timestamp && _ethBought > 0);

     uint tokenReserve = token.balanceOf(address(this));
     uint tokensSold = getOutputPrice(_ethBought, tokenReserve, address(this).balance);
     
     require(_maxTokens >= tokensSold);

    payable(_recipient).sendValue(_ethBought);
    require(token.transferFrom(_buyer, address(this), tokensSold));
    emit EthPurchase(_buyer, tokensSold, _ethBought);

    return tokensSold;
   }

  /// @notice Convert Tokens to ETH.
  /// @dev User specifies maximum input and exact output.
  /// @param _ethBought Amount of ETH purchased.
  /// @param _maxTokens Maximum Tokens sold.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @return Amount of Tokens sold.
  function tokenToEthSwapOutput(
    uint _ethBought, 
    uint _maxTokens, 
    uint _deadline
  ) public returns (uint) {
    return tokenToEthOutput(
      _ethBought, 
      _maxTokens, 
      _deadline, 
      msg.sender, 
      msg.sender
    );
  }

  /// @notice Convert Tokens to ETH and transfers ETH to recipient.
  /// @dev User specifies maximum input and exact output.
  /// @param _ethBought Amount of ETH purchased.
  /// @param _maxTokens Maximum Tokens sold.
  /// @param _deadline Time after which this transaction can no longer be executed.
  /// @param _recipient The address that receives output ETH.
  /// @return Amount of Tokens sold.
  function tokenToEthTransferOutput(
    uint _ethBought, 
    uint _maxTokens, 
    uint _deadline, 
    address _recipient
  ) public returns(uint) {
    require(_recipient != address(this) && _recipient != address(0));

    return tokenToEthOutput(_ethBought, _maxTokens, _deadline, msg.sender, _recipient);
  }


  /// @dev Buy tokens from other exchange for tokens of current exchange 
  /// 2 steps:
  /// - current tokens => ETH 
  /// - ETH => tokens of other exchange
  /// @param _tokensSold how much tokens of current exchange to pay for the trade
  /// @param _minTokensBought minimal desired amount of tokens of other exchange
  /// @param _minEthBought minimal desired amount of ETH to get for intermediate trade
  /// @param _deadline do not execute the trade after
  /// @param _buyer address pays tokens for the trade
  /// @param _recipient address receives tokens of other exchange
  /// @param _exchangeAddr exchange address, should implement the interface {Exchange}
  /// @return Amount of tokens bought.
  function tokenToTokenInput(
    uint _tokensSold, 
    uint _minTokensBought, 
    uint _minEthBought, 
    uint _deadline, 
    address _buyer,
    address _recipient,
    address _exchangeAddr
    ) private returns (uint) {
      require((_deadline >= block.timestamp && _tokensSold > 0)
        && (_minTokensBought > 0 && _minEthBought > 0));
      require(_exchangeAddr != address(this) && _exchangeAddr != address(0));

      uint tokenReserve = token.balanceOf(address(this));
      uint ethBought = getInputPrice(_tokensSold, tokenReserve, address(this).balance);

      require(ethBought >= _minEthBought);
      emit EthPurchase(_buyer, _tokensSold, ethBought);

      require(token.transferFrom(_buyer, address(this), _tokensSold));
      uint tokensBought = Exchange(_exchangeAddr).ethToTokenTransferInput{value: ethBought}(
        _minTokensBought, _deadline, _recipient
      );

      return tokensBought;
    }

    /// @notice Convert Tokens (token) to Tokens (token_addr).
    /// @dev User specifies exact input and minimum output.
    /// @param _tokensSold Amount of Tokens sold.
    /// @param _minTokensBought Minimum Tokens (token_addr) purchased.
    /// @param _minEthBought Minimum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _tokenAddr The address of the token being purchased.
    /// @return Amount of Tokens (token_addr) bought.
    function tokenToTokenSwapInput(
      uint _tokensSold,
      uint _minTokensBought,
      uint _minEthBought,
      uint _deadline,
      address _tokenAddr
    ) public returns(uint) {
      address exchangeAddr = factory.getExchange(_tokenAddr);

      return tokenToTokenInput(
        _tokensSold, 
        _minTokensBought, 
        _minEthBought, 
        _deadline, 
        msg.sender, 
        msg.sender, 
        exchangeAddr
      );
    }


    /// @notice Convert Tokens (token) to Tokens (token_addr) and transfers
    ///         Tokens (token_addr) to recipient.
    /// @dev User specifies exact input and minimum output.
    /// @param _tokensSold Amount of Tokens sold.
    /// @param _minTokensBought Minimum Tokens (token_addr) purchased.
    /// @param _minEthBought Minimum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _recipient The address that receives output ETH.
    /// @param _tokenAddr The address of the token being purchased.
    /// @return Amount of Tokens (token_addr) bought.
    function tokenToTokenTransferInput(
      uint _tokensSold,
      uint _minTokensBought,
      uint _minEthBought,
      uint _deadline,
      address _recipient,
      address _tokenAddr
    ) public returns(uint) {
      address exchangeAddr = factory.getExchange(_tokenAddr);

      return tokenToTokenInput(
        _tokensSold, 
        _minTokensBought, 
        _minEthBought, 
        _deadline, 
        msg.sender, 
        _recipient, 
        exchangeAddr
      );
    }

    /// @dev Buy tokens from other exchange for tokens of current exchange 
    /// 2 steps:
    /// - current tokens => ETH 
    /// - ETH => tokens of other exchange
    /// @param _tokensBought desirable amount of tokens of other exchange to buy
    /// @param _maxTokensSold max desired amount of tokens of current exchange to spend
    /// @param _maxEthSold Maximum ETH purchased as intermediary.
    /// @param _deadline do not execute the trade after
    /// @param _buyer address pays tokens for the trade
    /// @param _recipient address receives tokens of other exchange
    /// @param _exchangeAddr exchange address, should implement the interface {Exchange}
    /// @return Amount of tokens bought.
    function tokenToTokenOutput(
      uint _tokensBought,
      uint _maxTokensSold,
      uint _maxEthSold,
      uint _deadline,
      address _buyer,
      address _recipient,
      address _exchangeAddr
    ) private returns(uint) {
      require(_deadline >= block.timestamp && (_tokensBought > 0 && _maxEthSold > 0));
      require(_exchangeAddr != address(this) && _exchangeAddr != address(0));

      uint ethBought = Exchange(_exchangeAddr).getEthToTokenOutputPrice(_tokensBought);
      uint tokenReserve = token.balanceOf(address(this));
      uint tokensSold = getOutputPrice(ethBought, tokenReserve, address(this).balance);

      require(_maxTokensSold >= tokensSold && _maxEthSold >= ethBought);
      require(token.transferFrom(_buyer, address(this), tokensSold));

      Exchange(_exchangeAddr).ethToTokenTransferOutput{value: ethBought}(
        _tokensBought,
        _deadline,
        _recipient
      );
      
      emit EthPurchase(_buyer, tokensSold, ethBought);

      return tokensSold;
    }

    /// @notice Convert Tokens (token) to Tokens (token_addr).
    /// @dev User specifies maximum input and exact output.
    /// @param _tokensBought Amount of Tokens (token_addr) bought.
    /// @param _maxTokensSold Maximum Tokens (token) sold.
    /// @param _maxEthSold Maximum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _tokenAddr The address of the token being purchased.
    /// @return Amount of Tokens (token) sold.
    function tokenToTokenSwapOutput(
      uint _tokensBought,
      uint _maxTokensSold,
      uint _maxEthSold,
      uint _deadline,
      address _tokenAddr
    ) public returns (uint) {
      address exchangeAddr = factory.getExchange(_tokenAddr);

      return tokenToTokenOutput(
        _tokensBought,
        _maxTokensSold,
        _maxEthSold,
        _deadline,
        msg.sender,
        msg.sender,
        exchangeAddr
      );
    }


    /// @notice Convert Tokens (token) to Tokens (token_addr) and transfers
    ///         Tokens (token_addr) to recipient.
    /// @dev User specifies maximum input and exact output.
    /// @param _tokensBought Amount of Tokens (token_addr) bought.
    /// @param _maxTokenSold Maximum Tokens (token) sold.
    /// @param _maxEthSold Maximum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _recipient The address that receives output ETH.
    /// @param _tokenAddr The address of the token being purchased.
    /// @return Amount of Tokens (token) sold.
    function tokenToTokenTransferOutput(
      uint _tokensBought,
      uint _maxTokenSold,
      uint _maxEthSold,
      uint _deadline,
      address _recipient,
      address _tokenAddr
    ) public returns (uint) {
      address exchangeAddr = factory.getExchange(_tokenAddr);

      return tokenToTokenOutput(
        _tokensBought,
        _maxTokenSold,
        _maxEthSold,
        _deadline,
        msg.sender,
        _recipient,
        exchangeAddr
      );
    }


    /// @notice Convert Tokens (token) to Tokens (exchange_addr.token).
    /// @dev Allows trades through contracts that were not deployed from the same factory.
    /// @dev User specifies exact input and minimum output.
    /// @param _tokensSold Amount of Tokens sold.
    /// @param _minTokensBought Minimum Tokens (token_addr) purchased.
    /// @param _minTokensBought Minimum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _exchangeAddr The address of the exchange for the token being purchased.
    /// @return Amount of Tokens (exchange_addr.token) bought.
    function tokenToExchangeSwapInput(
      uint _tokensSold,
      uint _minTokensBought,
      uint _minEthBought,
      uint _deadline,
      address _exchangeAddr
    ) public returns (uint) {
      return tokenToTokenInput(
        _tokensSold,
        _minTokensBought,
        _minEthBought,
        _deadline,
        msg.sender, 
        msg.sender,
        _exchangeAddr
      );
    }

    /// @notice Convert Tokens (token) to Tokens (exchange_addr.token) and transfers
    ///         Tokens (exchange_addr.token) to recipient.
    /// @dev Allows trades through contracts that were not deployed from the same factory.
    /// @dev User specifies exact input and minimum output.
    /// @param _tokensSold Amount of Tokens sold.
    /// @param _minTokensBought Minimum Tokens (token_addr) purchased.
    /// @param _minEthBought Minimum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _recipient The address that receives output ETH.
    /// @param _exchangeAddr The address of the exchange for the token being purchased.
    /// @return Amount of Tokens (exchange_addr.token) bought.
    function tokenToExchangeTransferInput(
       uint _tokensSold,
      uint _minTokensBought,
      uint _minEthBought,
      uint _deadline,
      address _recipient,
      address _exchangeAddr
    ) public returns (uint) {
      return tokenToTokenInput(
        _tokensSold,
        _minTokensBought,
        _minEthBought,
        _deadline,
        msg.sender, 
        _recipient,
        _exchangeAddr
      );
    }

    /// @notice Convert Tokens (token) to Tokens (exchange_addr.token).
    /// @dev Allows trades through contracts that were not deployed from the same factory.
    /// @dev User specifies maximum input and exact output.
    /// @param _tokensBought Amount of Tokens (token_addr) bought.
    /// @param _maxTokensSold Maximum Tokens (token) sold.
    /// @param _maxEthSold Maximum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _exchangeAddr The address of the exchange for the token being purchased.
    /// @return Amount of Tokens (token) sold.
    function tokenToExchangeSwapOutput(
      uint _tokensBought,
      uint _maxTokensSold,
      uint _maxEthSold,
      uint _deadline,
      address _exchangeAddr
    ) public returns (uint) {
      return tokenToTokenOutput(
        _tokensBought,
        _maxTokensSold,
        _maxEthSold,
        _deadline,
        msg.sender,
        msg.sender,
        _exchangeAddr
      );
    }

    /// @notice Convert Tokens (token) to Tokens (exchange_addr.token) and transfers
    ///         Tokens (exchange_addr.token) to recipient.
    /// @dev Allows trades through contracts that were not deployed from the same factory.
    /// @dev User specifies maximum input and exact output.
    /// @param _tokensBought Amount of Tokens (token_addr) bought.
    /// @param _maxTokensSold Maximum Tokens (token) sold.
    /// @param _maxEthSold Maximum ETH purchased as intermediary.
    /// @param _deadline Time after which this transaction can no longer be executed.
    /// @param _recipient The address that receives output ETH.
    /// @param _exchangeAddr The address of the token being purchased.
    /// @return Amount of Tokens (token) sold.
    function tokenToExchangeTransferOutput(
      uint _tokensBought,
      uint _maxTokensSold,
      uint _maxEthSold,
      uint _deadline,
      address _recipient,
      address _exchangeAddr
    ) public returns(uint) {
      require(_recipient != address(this));

      return tokenToTokenOutput(
        _tokensBought,
        _maxTokensSold,
        _maxEthSold,
        _deadline,
        msg.sender,
        _recipient,
        _exchangeAddr
      );
    }

    /// @notice Public price function for ETH to Token trades with an exact input.
    /// @param _ethSold Amount of ETH sold.
    /// @return Amount of Tokens that can be bought with input ETH.
    function getEthToTokenInputPrice(uint _ethSold) 
    public view returns(uint) {
      require(_ethSold > 0);
      uint tokenReserve = token.balanceOf(address(this));

      return getInputPrice(_ethSold, address(this).balance, tokenReserve);
    }

    /// @notice Public price function for ETH to Token trades with an exact output.
    /// @param _tokensBought Amount of Tokens bought.
    /// @return Amount of ETH needed to buy output Tokens.
    function getEthToTokenOutputPrice(uint _tokensBought) 
    public view returns(uint) {
      require(_tokensBought > 0);

      uint tokenReserve = token.balanceOf(address(this));
      uint ethSold = getOutputPrice(_tokensBought, address(this).balance, tokenReserve);

      return ethSold;
    }

    /// @notice Public price function for Token to ETH trades with an exact input.
    /// @param _tokensSold Amount of Tokens sold.
    /// @return Amount of ETH that can be bought with input Tokens.
    function getTokenToEthInputPrice(uint _tokensSold) 
    public view returns(uint) {
      require(_tokensSold > 0);
      uint tokenReserve = token.balanceOf(address(this));
      uint ethBought = getInputPrice(_tokensSold, tokenReserve, address(this).balance);

      return ethBought;
    }

    /// @notice Public price function for Token to ETH trades with an exact output.
    /// @param _ethBought Amount of output ETH.
    /// @return Amount of Tokens needed to buy output ETH.
    function getTokenToEthOutputPrice(
      uint _ethBought
    ) public view returns (uint) {
      require(_ethBought > 0);
      uint tokenReserve = token.balanceOf(address(this));

      return getOutputPrice(_ethBought, tokenReserve, address(this).balance);
    }


    /// @return Address of Token that is sold on this exchange.
    function tokenAddress() public view returns (address) {
      return address(token);
    }

    /// @return Address of factory that created this exchange.
    function factoryAddress() public view returns (address) {
      return address(factory);
    }
}