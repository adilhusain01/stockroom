export const LiquidatorAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "controller_",
        "type": "address",
        "internalType": "contract Controller"
      },
      {
        "name": "swapRouter_",
        "type": "address",
        "internalType": "contract ISwapRouterV3"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IERC20"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "controller",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Controller"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "liquidateWithFlash",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "repayRaw",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "buyPath",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "minProfitCash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "profit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "onFlashLoan",
    "inputs": [
      {
        "name": "initiator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "fee",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "swapRouter",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ISwapRouterV3"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "FlashLiquidated",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "repaidRaw",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "profitCash",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BelowMinProfit",
    "inputs": [
      {
        "name": "profit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minProfit",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPool",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotSelf",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  }
] as const;
