const express = require("express");
const ethers = require("ethers");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const chainsPath = path.join(__dirname, "helper/chains.json");
let chains;
try {
  if (!fs.existsSync(chainsPath)) {
    console.error("chains.json not found at:", chainsPath);
    throw new Error("chains.json file missing");
  }
  chains = require(chainsPath).chains;
  console.log("Loaded chains:", chains.map(c => ({ chainId: c.chainId, name: c.name })));
} catch (error) {
  console.error("Failed to load chains.json:", error.message);
  chains = [];
}

// Create provider with fallback RPCs
async function createProvider(rpc) {
  if (Array.isArray(rpc)) {
    for (const url of rpc) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(url);
        await provider.getNetwork();
        console.log(`Connected to RPC: ${url}`);
        return provider;
      } catch (error) {
        console.error(`Failed to connect to RPC ${url}:`, error.message);
      }
    }
    throw new Error("All RPCs failed");
  }
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  await provider.getNetwork(); 
  return provider;
}

app.post("/transfer", async (req, res) => {
  console.log("Received /transfer request:", req.body);
  try {
    const { privateKey, chainId, amountPerWallet, receivers } = req.body;

    // Validate required fields
    if (!privateKey || !chainId || !amountPerWallet || !receivers || !Array.isArray(receivers)) {
      console.error("Missing required fields:", { privateKey: !!privateKey, chainId: !!chainId, amountPerWallet: !!amountPerWallet, receivers: !!receivers });
      return res.status(400).json({ success: false, error: "Missing privateKey, chainId, amountPerWallet, or receivers" });
    }

    const parsedChainId = parseInt(chainId);
    if (isNaN(parsedChainId)) {
      console.error("Invalid chainId:", chainId);
      return res.status(400).json({ success: false, error: `Invalid chainId: ${chainId}` });
    }
    const chain = chains.find(c => c.chainId === parsedChainId);
    if (!chain) {
      console.error("Chain not found for chainId:", parsedChainId, "Available chains:", chains.map(c => c.chainId));
      return res.status(400).json({ success: false, error: `Chain not found for chainId: ${parsedChainId}` });
    }

    // Validate privateKey
    if (!privateKey.match(/^0x[0-9a-fA-F]{64}$/)) {
      console.error("Invalid privateKey format:", privateKey);
      return res.status(400).json({ success: false, error: "Invalid privateKey format" });
    }

    console.log("Attempting to create wallet with privateKey:", privateKey.slice(0, 10) + "...");

    let provider;
    try {
      provider = await createProvider(chain.rpc);
    } catch (error) {
      console.error("Failed to create provider:", error.message);
      return res.status(500).json({ success: false, error: `Failed to connect to network: ${error.message}` });
    }

    let wallet;
    try {
      wallet = new ethers.Wallet(privateKey, provider);
      console.log("Wallet created successfully, address:", wallet.address);
    } catch (error) {
      console.error("Failed to create wallet:", error.message);
      return res.status(400).json({ success: false, error: `Invalid privateKey: ${error.message}` });
    }

    const amountWei = ethers.utils.parseEther(amountPerWallet.toString());

    const transactions = [];
    for (const receiver of receivers) {
      const gasPrice = await provider.getGasPrice();
      const gasLimit = await provider.estimateGas({
        to: receiver,
        value: amountWei,
      });
      const nonce = await provider.getTransactionCount(wallet.address, "pending");
      const tx = await wallet.signTransaction({
        to: receiver,
        value: amountWei,
        gasLimit,
        gasPrice,
        nonce,
      });
      const txResponse = await provider.sendTransaction(tx);
      const receipt = await txResponse.wait();
      if (receipt.status === 1) {
        transactions.push({ receiver, hash: txResponse.hash });
      } else {
        throw new Error(`Transaction failed for ${receiver}`);
      }
    }

    res.json({ success: true, transactions });
  } catch (error) {
    console.error("Backend transfer error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(3000, () => {
  console.log("Backend server running on http://127.0.0.1:3000");
});