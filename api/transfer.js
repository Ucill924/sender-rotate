const express = require("express");
const ethers = require("ethers");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors({ origin: "https://sender-rotate.vercel.app", methods: ["POST"], credentials: true }));
app.use(express.json({ limit: "10mb" }));

console.log("Starting server, __dirname:", __dirname);

const chainsPath = path.join(__dirname, "../helper/chains.json");
let chains;

try {
  console.log("Checking for chains.json at:", chainsPath);
  if (!fs.existsSync(chainsPath)) {
    throw new Error("chains.json file missing");
  }
  chains = require(chainsPath).chains;
  console.log("Loaded chains:", chains.map(c => ({ chainId: c.chainId, name: c.name })));
} catch (error) {
  console.error("Failed to load chains.json:", error.message, error.stack);
  app.post("/api/transfer", (req, res) => {
    res.status(500).json({ success: false, error: `Failed to load chains.json: ${error.message}` });
  });
  module.exports = app;
  return;
}

async function createProvider(rpc) {
  console.log("Creating provider with RPCs:", rpc);
  if (Array.isArray(rpc)) {
    for (const url of rpc) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(url);
        const network = await provider.getNetwork();
        console.log(`Connected to RPC: ${url}, network:`, network);
        return provider;
      } catch (error) {
        console.error(`Failed to connect to RPC ${url}:`, error.message);
      }
    }
    throw new Error("All RPCs failed");
  }
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  console.log("Connected to single RPC:", rpc, "network:", network);
  return provider;
}

app.get("/api/health", (req, res) => {
  console.log("Health check called");
  res.json({ status: "OK", message: "Server is running", chainsLoaded: !!chains });
});

app.post("/api/transfer", async (req, res) => {
  console.log("Received POST /api/transfer:", JSON.stringify(req.body, null, 2));
  try {
    const { privateKeys, chainId, amountPerWallet, receivers } = req.body;

    if (!privateKeys || !Array.isArray(privateKeys) || privateKeys.length === 0 || !chainId || !amountPerWallet || !receivers || !Array.isArray(receivers)) {
      console.error("Missing required fields:", { privateKeys: !!privateKeys, chainId: !!chainId, amountPerWallet: !!amountPerWallet, receivers: !!receivers });
      return res.status(400).json({ success: false, error: "Missing privateKeys, chainId, amountPerWallet, or receivers" });
    }

    if (privateKeys.length < receivers.length) {
      console.error(`Not enough private keys (${privateKeys.length}) for ${receivers.length} receivers`);
      return res.status(400).json({ success: false, error: `Not enough private keys (${privateKeys.length}) for ${receivers.length} receivers` });
    }

    const parsedChainId = parseInt(chainId);
    if (isNaN(parsedChainId)) {
      console.error("Invalid chainId:", chainId);
      return res.status(400).json({ success: false, error: `Invalid chainId: ${chainId}` });
    }
    const chain = chains.find(c => c.chainId === parsedChainId);
    if (!chain) {
      console.error("Chain not found for chainId:", parsedChainId);
      return res.status(400).json({ success: false, error: `Chain not found for chainId: ${parsedChainId}` });
    }

    let provider;
    try {
      provider = await createProvider(chain.rpc);
    } catch (error) {
      console.error("Failed to create provider:", error.message);
      return res.status(500).json({ success: false, error: `Failed to connect to network: ${error.message}` });
    }

    const wallets = privateKeys.map((pk, i) => {
      try {
        const wallet = new ethers.Wallet(pk, provider);
        console.log(`Wallet ${i + 1} created, address:`, wallet.address);
        return wallet;
      } catch (error) {
        console.error(`Failed to create wallet ${i + 1} for privateKey ${pk.slice(0, 10)}...:`, error.message);
        return null;
      }
    });

    if (wallets.includes(null)) {
      return res.status(400).json({ success: false, error: "One or more invalid private keys" });
    }

    const amountWei = ethers.utils.parseEther(amountPerWallet.toString());
    const transactions = [];

    console.log(`Processing ${receivers.length} receivers with ${wallets.length} wallets`);
    for (let i = 0; i < receivers.length; i++) {
      const receiver = receivers[i];
      const currentWallet = wallets[i];
      console.log(`Using wallet ${currentWallet.address.slice(0, 6)}... for receiver ${receiver.slice(0, 6)}...`);

      const balance = await provider.getBalance(currentWallet.address);
      console.log(`Balance for wallet ${currentWallet.address.slice(0, 6)}...: ${ethers.utils.formatEther(balance)} ETH`);
      const gasPrice = await provider.getGasPrice();
      console.log(`Gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
      const gasLimit = await provider.estimateGas({ to: receiver, value: amountWei });
      console.log(`Gas limit for TX to ${receiver.slice(0, 6)}...: ${gasLimit.toString()}`);
      const gasCost = gasPrice.mul(gasLimit);
      const totalCost = amountWei.add(gasCost);

      if (balance.lt(totalCost)) {
        console.error(`Insufficient balance for wallet ${currentWallet.address.slice(0, 6)}...: ${ethers.utils.formatEther(balance)} ETH, need ${ethers.utils.formatEther(totalCost)} ETH`);
        return res.status(400).json({ success: false, error: `Insufficient balance for wallet ${currentWallet.address.slice(0, 6)}...` });
      }

      const nonce = await provider.getTransactionCount(currentWallet.address, "pending");
      console.log(`Nonce for wallet ${currentWallet.address.slice(0, 6)}...: ${nonce}`);
      const tx = await currentWallet.signTransaction({ to: receiver, value: amountWei, gasLimit, gasPrice, nonce });
      const txResponse = await provider.sendTransaction(tx);
      console.log(`TX sent: ${txResponse.hash} to ${receiver}`);
      const receipt = await txResponse.wait(1);
      if (receipt.status === 1) {
        transactions.push({ receiver, hash: txResponse.hash, sender: currentWallet.address });
        console.log(`TX successful: ${txResponse.hash}`);
      } else {
        console.error(`TX failed for ${receiver}: ${txResponse.hash}`);
        return res.status(500).json({ success: false, error: `Transaction failed for ${receiver}` });
      }

      if (i < receivers.length - 1) {
        const nextWallet = wallets[i + 1];
        const nextBalance = await provider.getBalance(currentWallet.address);
        console.log(`Next balance for wallet ${currentWallet.address.slice(0, 6)}...: ${ethers.utils.formatEther(nextBalance)} ETH`);
        const nextGasPrice = await provider.getGasPrice();
        const nextGasLimit = await provider.estimateGas({ to: nextWallet.address, value: nextBalance });
        const nextGasCost = nextGasPrice.mul(nextGasLimit);
        const transferAmount = nextBalance.sub(nextGasCost);

        if (transferAmount.lte(0)) {
          console.error(`No balance to transfer from ${currentWallet.address.slice(0, 6)}... to next wallet`);
          return res.status(400).json({ success: false, error: `No balance to transfer from ${currentWallet.address.slice(0, 6)}...` });
        }

        const nextNonce = await provider.getTransactionCount(currentWallet.address, "pending");
        console.log(`Next nonce for wallet ${currentWallet.address.slice(0, 6)}...: ${nextNonce}`);
        const nextTx = await currentWallet.signTransaction({ to: nextWallet.address, value: transferAmount, gasLimit: nextGasLimit, gasPrice: nextGasPrice, nonce: nextNonce });
        const nextTxResponse = await provider.sendTransaction(nextTx);
        console.log(`TX sent: ${nextTxResponse.hash} to next wallet ${nextWallet.address.slice(0, 6)}...`);
        const nextReceipt = await nextTxResponse.wait(1);
        if (nextReceipt.status === 1) {
          transactions.push({ receiver: nextWallet.address, hash: nextTxResponse.hash, sender: currentWallet.address });
          console.log(`TX successful to next wallet: ${nextTxResponse.hash}`);
        } else {
          console.error(`TX failed to next wallet ${nextWallet.address}: ${nextTxResponse.hash}`);
          return res.status(500).json({ success: false, error: `Transaction failed to next wallet ${nextWallet.address}` });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    res.json({ success: true, transactions });
  } catch (error) {
    console.error("Backend transfer error:", error.message, error.stack);
    return res.status(500).json({ success: false, error: `Internal server error: ${error.message}` });
  }
});

app.use((req, res) => {
  console.log(`Received ${req.method} request to ${req.path}`);
  res.status(405).json({ success: false, error: `Method ${req.method} not allowed` });
});

module.exports = app;
