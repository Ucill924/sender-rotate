function log(message, color = "") {
  const logDiv = document.getElementById("log");
  if (logDiv) {
    logDiv.innerHTML += `<div style="color: ${color}">${message}</div>`;
    logDiv.scrollTop = logDiv.scrollHeight;
  }
  console.log(`[${color || "black"}] ${message}`);
}

let provider;
let signer;
let connectedAddress;
let chains = [];
let mainWallets = [];
let lastCalculatedTotal = null;
const COFFEE_WALLET = "0xF57261dcfFAcb4F15ecd12dD89B7ae9F2Fad07989";

function loadChains() {
  fetch("/helper/chains.json")
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      return response.json();
    })
    .then(data => {
      if (!data.chains) throw new Error("Invalid JSON structure: 'chains' key missing");
      chains = data.chains;
      const chainSelect = document.getElementById("chainSelect");
      if (!chainSelect) throw new Error("Chain select element not found");
      chainSelect.innerHTML = "";
      chains.forEach(chain => {
        const option = document.createElement("option");
        option.value = chain.chainId;
        option.textContent = chain.name;
        chainSelect.appendChild(option);
      });
      log("✅ Loaded chain configurations", "green");
    })
    .catch(error => {
      log(`❌ Failed to load chains: ${error.message}`, "red");
      console.error("Fetch error:", error);
    });
}

function generateMainWallet() {
  try {
    if (!lastCalculatedTotal) {
      log("❌ Run Calculate Total first", "red");
      return;
    }
    const { receivers } = lastCalculatedTotal;

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

function calculateTotal() {
  try {
    if (!provider) {
      log("❌ Connect wallet and select chain first", "red");
      document.getElementById("totalDeposit").textContent = "Connect wallet first";
      return;
    }
    const amountPerWalletInput = document.getElementById("amountPerWallet").value;
    const receivers = document.getElementById("receivers").value
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.match(/^0x[0-9a-fA-F]{40}$/));

    if (!amountPerWalletInput || isNaN(amountPerWalletInput) || parseFloat(amountPerWalletInput) <= 0) {
      log("❌ Invalid amount per wallet", "red");
      document.getElementById("totalDeposit").textContent = "Invalid amount";
      return;
    }
    if (!receivers.length) {
      log("❌ No valid receiver addresses provided", "red");
      document.getElementById("totalDeposit").textContent = "No receivers";
      return;
    }

    const amountPerWallet = ethers.utils.parseEther(amountPerWalletInput);
    Promise.all([
      provider.getGasPrice(),
      provider.estimateGas({ to: receivers[0], value: amountPerWallet }),
    ])
      .then(([gasPrice, gasLimit]) => {
        const gasCost = gasLimit.mul(gasPrice);
        const totalGasCost = gasCost.mul(receivers.length * 2);
        const totalAmount = amountPerWallet.mul(receivers.length);
        const totalDeposit = totalAmount.add(totalGasCost);
        lastCalculatedTotal = { totalDeposit, amountPerWallet, receivers };
        document.getElementById("totalDeposit").textContent = `${ethers.utils.formatEther(totalDeposit)} (Amount: ${ethers.utils.formatEther(totalAmount)}, Gas for ${receivers.length * 2} txs: ${ethers.utils.formatEther(totalGasCost)})`;
        log(`✅ Total deposit calculated: ${ethers.utils.formatEther(totalDeposit)}`, "green");
        log(`ℹ️ Inputs: amountPerWallet=${amountPerWalletInput}, receivers=${receivers.length}`, "cyan");
        // Aktifkan tombol Deposit Wallet
        document.getElementById("generateMainWallet").disabled = false;
      })
      .catch(error => {
        log(`❌ Calculation failed: ${error.message}`, "red");
        document.getElementById("totalDeposit").textContent = "Calculation error";
      });
  } catch (error) {
    log(`❌ Calculation failed: ${error.message}`, "red");
    document.getElementById("totalDeposit").textContent = "Calculation error";
  }
}

function buyMeCoffee() {
  const modal = new bootstrap.Modal(document.getElementById("coffeeModal"));
  const confirmButton = document.getElementById("confirmCoffee");
  const coffeeAmountInput = document.getElementById("coffeeAmount");

  coffeeAmountInput.value = "";

  const handleConfirm = async () => {
    try {
      if (!provider || !signer) {
        log("❌ Connect wallet first", "red");
        return;
      }
      const amountInput = coffeeAmountInput.value;
      if (!amountInput || isNaN(amountInput) || parseFloat(amountInput) <= 0) {
        log("❌ Invalid ETH amount", "red");
        coffeeAmountInput.classList.add("is-invalid");
        return;
      }
      coffeeAmountInput.classList.remove("is-invalid");
      const coffeeAmount = ethers.utils.parseEther(amountInput);

      const [gasPrice, gasLimit, balance] = await Promise.all([
        provider.getGasPrice(),
        provider.estimateGas({ to: COFFEE_WALLET, value: coffeeAmount }),
        provider.getBalance(connectedAddress),
      ]);

      const gasCost = gasLimit.mul(gasPrice);
      const totalCost = coffeeAmount.add(gasCost);
      if (balance.lt(totalCost)) {
        log(`❌ Insufficient balance for coffee donation. Need ${ethers.utils.formatEther(totalCost)} ETH`, "red");
        return;
      }

      const txResponse = await signer.sendTransaction({
        to: COFFEE_WALLET,
        value: coffeeAmount,
        gasPrice,
        gasLimit,
      });

      if (!txResponse.hash) {
        log("❌ Coffee TX failed: No transaction hash", "red");
        return;
      }

      log(`🚀 Coffee TX Sent: ${txResponse.hash} | ⏳ Awaiting confirmation...`, "cyan");
      const receipt = await txResponse.wait(1);
      if (receipt.status === 1) {
        log(`✅ Coffee TX Successful: ${txResponse.hash}`, "green");
      } else {
        log(`❌ Coffee TX Failed: ${txResponse.hash}`, "red");
      }
      modal.hide();
    } catch (error) {
      log(`❌ Coffee TX failed: ${error.message}`, "red");
      console.error("Coffee TX error:", error);
    }
  };

  confirmButton.onclick = handleConfirm;
  modal.show();
}

function connectWallet() {
  if (!window.ethereum) {
    log("❌ Please install MetaMask!", "red");
    return;
  }
  window.ethereum.request({ method: "eth_requestAccounts" })
    .then(accounts => {
      connectedAddress = accounts[0];
      document.getElementById("connectWallet").textContent = `Connected: ${connectedAddress.slice(0, 6)}...`;
      document.getElementById("connectWallet").style.display = "none";
      document.getElementById("disconnectWallet").style.display = "inline-block";
      document.getElementById("depositAndTransfer").disabled = !mainWallets.length;
      const chainId = document.getElementById("chainSelect").value;
      switchChain(chainId);
      log(`✅ Connected wallet: ${connectedAddress.slice(0, 6)}...`, "green");
    })
    .catch(error => {
      log(`❌ Connection failed: ${error.message}`, "red");
      console.error("Connect wallet error:", error);
    });
}

function disconnectWallet() {
  window.ethereum.request({
    method: "wallet_revokePermissions",
    params: [{ eth_accounts: {} }],
  })
    .then(() => {
      connectedAddress = null;
      provider = null;
      signer = null;
      document.getElementById("connectWallet").textContent = "Connect Wallet";
      document.getElementById("connectWallet").style.display = "inline-block";
      document.getElementById("disconnectWallet").style.display = "none";
      document.getElementById("depositAndTransfer").disabled = true;
      log("✅ Wallet disconnected", "green");
    })
    .catch(error => {
      log(`❌ Disconnect failed: ${error.message}`, "red");
      console.error("Disconnect error:", error);
    });
}

function switchChain(chainId) {
  const chain = chains.find(c => c.chainId === parseInt(chainId));
  if (!chain) {
    log(`❌ Chain ID ${chainId} not found`, "red");
    return;
  }
  window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${parseInt(chainId).toString(16)}` }],
  })
    .then(() => {
      provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = provider.getSigner();
      log(`✅ Switched to ${chain.name}`, "green");
    })
    .catch(error => {
      if (error.code === 4902) {
        window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: `0x${parseInt(chainId).toString(16)}`,
            chainName: chain.name,
            rpcUrls: Array.isArray(chain.rpc) ? chain.rpc : [chain.rpc],
          }],
        })
          .then(() => {
            provider = new ethers.providers.Web3Provider(window.ethereum);
            signer = provider.getSigner();
            log(`✅ Added and switched to ${chain.name}`, "green");
          })
          .catch(addError => {
            log(`❌ Failed to add chain: ${addError.message}`, "red");
            console.error("Add chain error:", addError);
          });
      } else {
        log(`❌ Failed to switch chain: ${error.message}`, "red");
        console.error("Switch chain error:", error);
      }
    });
}

document.addEventListener("DOMContentLoaded", () => {
  const elements = {
    connectWallet: document.getElementById("connectWallet"),
    disconnectWallet: document.getElementById("disconnectWallet"),
    generateMainWallet: document.getElementById("generateMainWallet"),
    copyMainWallet: document.getElementById("copyMainWallet"),
    calculateTotal: document.getElementById("calculateTotal"),
    depositAndTransfer: document.getElementById("depositAndTransfer"),
    buyMeCoffee: document.getElementById("buyMeCoffee"),
    chainSelect: document.getElementById("chainSelect"),
  };

  for (const [key, element] of Object.entries(elements)) {
    if (!element) {
      log(`❌ Element not found: ${key}`, "red");
      console.error(`Element not found: ${key}`);
      return;
    }
  }

  elements.connectWallet.addEventListener("click", connectWallet);
  elements.disconnectWallet.addEventListener("click", disconnectWallet);
  elements.generateMainWallet.addEventListener("click", generateMainWallet);
  elements.copyMainWallet.addEventListener("click", () => {
    if (!mainWallets.length) {
      log("❌ No main wallets generated", "red");
      return;
    }
    const addresses = mainWallets.map(wallet => wallet.address).join("\n");
    navigator.clipboard.writeText(addresses)
      .then(() => log("✅ Main wallet addresses copied", "green"))
      .catch(error => log(`❌ Failed to copy addresses: ${error.message}`, "red"));
  });
  elements.calculateTotal.addEventListener("click", calculateTotal);
  elements.depositAndTransfer.addEventListener("click", () => {
    const chainId = document.getElementById("chainSelect").value;
    window.depositAndTransfer(provider, signer, connectedAddress, mainWallets, lastCalculatedTotal, chainId, log);
  });
  elements.buyMeCoffee.addEventListener("click", buyMeCoffee);

  loadChains();
});
