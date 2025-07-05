const express = require("express");
const ethers = require("ethers");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors({ origin: "https://sender-rotate.vercel.app" }));
app.use(express.json());

const chainsPath = path.join(__dirname, "../helper/chains.json");
let chains;
try {
  if (!fs.existsSync(chainsPath)) {
    throw new Error("chains.json file missing");
  }
  chains = require(chainsPath).chains;
  console.log("Loaded chains:", chains.map(c => ({ chainId: c.chainId, name: c.name })));
} catch (error) {
  console.error("Failed to load chains.json:", error.message);
  return res.status(500).json({ success: false, error: `Failed to load chains.json: ${error.message}` });
}

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
  console.log("Request body:", JSON.stringify(req.body, null, 2));
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

    const wallets = privateKeys.map(pk => {
      try {
        const wallet = new ethers.Wallet(pk, provider);
        console.log("Wallet created, address:", wallet.address);
        return wallet;
      } catch (error) {
        console.error("Failed to create wallet for privateKey:", pk.slice(0, 10) + "...", error.message);
        return res.status(400).json({ success: false, error: `Invalid privateKey: ${pk.slice(0, 10)}...` });
      }
    });

    const amountWei = ethers.utils.parseEther(amountPerWallet.toString());
    const transactions = [];

    console.log(`Processing ${receivers.length} receivers with ${wallets.length} wallets`);
    for (let i = 0; i < receivers.length; i++) {
      const receiver = receivers[i];
      const currentWallet = wallets[i]; // Gunakan wallet berurutan
      console.log(`Using wallet ${currentWallet.address.slice(0, 6)}... for receiver ${receiver.slice(0, 6)}...`);

      // Cek saldo
      const balance = await provider.getBalance(currentWallet.address);
      const gasPrice = await provider.getGasPrice();
      const gasLimit = await provider.estimateGas({ to: receiver, value: amountWei });
      const gasCost = gasPrice.mul(gasLimit);
      const totalCost = amountWei.add(gasCost);

      if (balance.lt(totalCost)) {
        console.error(`Insufficient balance for wallet ${currentWallet.address.slice(0, 6)}...`);
        return res.status(400).json({ success: false, error: `Insufficient balance for wallet ${currentWallet.address.slice(0, 6)}...` });
      }

      // Kirim ke penerima
      const nonce = await provider.getTransactionCount(currentWallet.address, "pending");
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

      // Kalau bukan transaksi terakhir, pindah balance ke wallet berikutnya
      if (i < receivers.length - 1) {
        const nextWallet = wallets[i + 1];
        const nextBalance = await provider.getBalance(currentWallet.address);
        const nextGasPrice = await provider.getGasPrice();
        const nextGasLimit = await provider.estimateGas({ to: nextWallet.address, value: nextBalance });
        const nextGasCost = nextGasPrice.mul(nextGasLimit);
        const transferAmount = nextBalance.sub(nextGasCost);

        if (transferAmount.lte(0)) {
          console.error(`No balance to transfer from ${currentWallet.address.slice(0, 6)}... to next wallet`);
          return res.status(400).json({ success: false, error: `No balance to transfer from ${currentWallet.address.slice(0, 6)}...` });
        }

        const nextNonce = await provider.getTransactionCount(currentWallet.address, "pending");
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

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.json({ success: true, transactions });
  } catch (error) {
    console.error("Backend transfer error:", error.stack);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
