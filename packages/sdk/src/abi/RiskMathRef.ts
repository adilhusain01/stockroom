export const RiskMathRefAbi = [
  {
    "type": "function",
    "name": "borrowRate",
    "inputs": [
      {
        "name": "utilisationWad",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct IRiskEngine.IrmParams",
        "components": [
          {
            "name": "baseWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "kinkWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "rateAtKinkWad",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "maxRateWad",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "dutchDiscount",
    "inputs": [
      {
        "name": "elapsed",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minWad",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxWad",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "duration",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "evaluate",
    "inputs": [
      {
        "name": "positions",
        "type": "tuple[]",
        "internalType": "struct IRiskEngine.PositionInput[]",
        "components": [
          {
            "name": "debtRaw",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "priceWad",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liqThresholdWad",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "initialRatioWad",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "collateralValueWad",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "error",
    "name": "InvalidDiscounts",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDuration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidIrm",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidKink",
    "inputs": []
  }
] as const;
