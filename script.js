let mainWallets = []; // Array untuk simpan multiple main wallets

function generateMainWallet() {
  try {
    const receivers = document.getElementById("receivers").value
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.match(/^0x[0-9a-fA-F]{40}$/)) || [];
    if (!receivers.length) {
      log("❌ Enter receiver addresses first", "red");
      return;
    }

    mainWallets = receivers.map(() => ethers.Wallet.createRandom());
    const mainWalletDisplay = document.getElementById("mainWalletDisplay");
    const copyMainWallet = document.getElementById("copyMainWallet");
    if (!mainWalletDisplay || !copyMainWallet) {
      log("❌ UI elements (mainWalletDisplay or copyMainWallet) not found", "red");
      return;
    }
    mainWalletDisplay.textContent = `Generated ${mainWallets.length} wallets: ${mainWallets[0].address} (first wallet)`;
    copyMainWallet.style.display = "inline-block";
    document.getElementById("depositAndTransfer").disabled = !connectedAddress;
    log(`✅ Generated ${mainWallets.length} main wallets`, "green");

    // Simpan semua wallets ke file
    const content = mainWallets.map((wallet, i) => `Main Wallet ${i + 1}: ${wallet.address} | ${wallet.privateKey}`).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "main_wallets.txt";
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    log(`❌ Generate main wallet failed: ${error.message}`, "red");
    console.error("Generate main wallet error:", error);
  }
}
