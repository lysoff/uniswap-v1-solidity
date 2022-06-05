const { BigNumber } = require("ethers");

module.exports.swapInput = function (inputAmount, inputReserve, outputReserve) {
  if (
    !BigNumber.isBigNumber(inputAmount) ||
    !BigNumber.isBigNumber(inputReserve) ||
    !BigNumber.isBigNumber(outputReserve)
  ) {
    throw new Error("swapInput: argument is not a BigNumber");
  }

  const numerator = inputAmount.mul(997).mul(outputReserve);
  const denominator = inputReserve.mul(1000).add(inputAmount.mul(997));
  return numerator.div(denominator);
};

module.exports.swapOutput = function (outputAmount, inputReserve, outputReserve) {
  if (
    !BigNumber.isBigNumber(outputAmount) ||
    !BigNumber.isBigNumber(inputReserve) ||
    !BigNumber.isBigNumber(outputReserve)
  ) {
    throw new Error("swapOutput: argument is not a BigNumber");
  }

  const numerator = inputReserve.mul(outputAmount).mul(1000);
  const denominator = outputReserve.sub(outputAmount).mul(997);
  return numerator.div(denominator);
};
