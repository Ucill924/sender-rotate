// depositAndTransfer.js
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
      const response = await fetch("http://127.0.0.1:3000/transfer", { // Change to /api/transfer on Vercel
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privateKey: mainWallet.privateKey,
          chainId: parseInt(chainId),
          amountPerWallet: ethers.utils.formatEther(amountPerWallet),
          receivers,
        }),
      });
      const data = await response.json();
      if (data.success) {
        log("✅ Backend transfers completed", "green");
        data.transactions.forEach((tx, i) => {
          log(`📤 Transferred ${ethers.utils.formatEther(amountPerWallet)} to ${receivers[i]}: ${tx.hash}`, "blue");
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