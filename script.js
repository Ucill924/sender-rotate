document.addEventListener("DOMContentLoaded", async () => {
  const logElement = document.getElementById("log");
  const chainSelect = document.getElementById("chainSelect");
  const amountPerWalletInput = document.getElementById("amountPerWallet");
  const receiversInput = document.getElementById("receivers");
  const totalDepositElement = document.getElementById("totalDeposit");
  const calculateTotalButton = document.getElementById("calculateTotal");
  const generateMainWalletButton = document.getElementById("generateMainWallet");
  const mainWalletDisplay = document.getElementById("mainWalletDisplay");
  const copyMainWalletButton = document.getElementById("copyMainWallet");
  const depositAndTransferButton = document.getElementById("depositAndTransfer");
  const connectWalletButton = document.getElementById("connectWallet");
  const disconnectWalletButton = document.getElementById("disconnectWallet");
  const buyMeCoffeeButton = document.getElementById("buyMeCoffee");
  const coffeeModal = new bootstrap.Modal(document.getElementById("coffeeModal"));
  const coffeeAmountInput = document.getElementById("coffeeAmount");
  const confirmCoffeeButton = document.getElementById("confirmCoffee");

  let provider, signer, connectedAddress, mainWallets = [], lastCalculatedTotal, chainId;

  const log = (message, color) => {
    const div = document.createElement("div");
    div.style.color = color;
    div.textContent = message;
    logElement.appendChild(div);
    logElement.scrollTop = logElement.scrollHeight;
  };

  const loadChains = async () => {
    try {
      const response = await fetch("/helper/chains.json");
      const data = await response.json();
      data.chains.forEach(chain => {
        const option = document.createElement("option");
        option.value = chain.chainId;
        option.textContent = chain.name;
        chainSelect.appendChild(option);
      });
      chainId = chainSelect.value;
    } catch (error) {
      log(`❌ Failed to load chains: ${error.message}`, "red");
    }
  };

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = provider.getSigner();
        connectedAddress = await signer.getAddress();
        log(`✅ Wallet connected: ${connectedAddress}`, "green");
        connectWalletButton.style.display = "none";
        disconnectWalletButton.style.display = "block";
        generateMainWalletButton.disabled = false;
      } catch (error) {
        log(`❌ Wallet connection failed: ${error.message}`, "red");
      }
    } else {
      log("❌ MetaMask not detected", "red");
    }
  };

  const disconnectWallet = () => {
    provider = null;
    signer = null;
    connectedAddress = null;
    log("ℹ️ Wallet disconnected", "cyan");
    connectWalletButton.style.display = "block";
    disconnectWalletButton.style.display = "none";
    generateMainWalletButton.disabled = true;
    depositAndTransferButton.disabled = true;
  };

  const calculateTotal = async () => {
    const amountPerWallet = parseFloat(amountPerWalletInput.value);
    const receivers = receiversInput.value.split("\n").map(addr => addr.trim()).filter(addr => addr);
    if (isNaN(amountPerWallet) || amountPerWallet <= 0) {
      log("❌ Invalid amount per wallet", "red");
      return;
    }
    if (receivers.length === 0) {
      log("❌ No receivers provided", "red");
      return;
    }
    const amountWei = ethers.utils.parseEther(amountPerWallet.toString());
    const totalDeposit = amountWei.mul(receivers.length);
    lastCalculatedTotal = { totalDeposit, amountPerWallet: amountWei, receivers };
    totalDepositElement.textContent = `Total: ${ethers.utils.formatEther(totalDeposit)} ETH`;
    log(`✅ Calculated total: ${ethers.utils.formatEther(totalDeposit)} ETH for ${receivers.length} receivers`, "green");
    generateMainWalletButton.disabled = false;
  };

  const generateMainWallet = () => {
    if (!lastCalculatedTotal) {
      log("❌ Run Calculate Total first", "red");
      return;
    }
    mainWallets = [];
    for (let i = 0; i < lastCalculatedTotal.receivers.length; i++) {
      const wallet = ethers.Wallet.createRandom();
      mainWallets.push(wallet);
    }
    mainWalletDisplay.textContent = mainWallets[0].address;
    copyMainWalletButton.style.display = "block";
    depositAndTransferButton.disabled = false;
    log(`✅ Generated ${mainWallets.length} main wallets`, "green");
    const blob = new Blob([mainWallets.map(w => w.privateKey).join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "main_wallets.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyMainWallet = () => {
    navigator.clipboard.writeText(mainWalletDisplay.textContent);
    log("✅ Copied main wallet address", "green");
  };

  const buyMeCoffee = async () => {
    if (!provider || !signer) {
      log("❌ Connect wallet first", "red");
      return;
    }
    coffeeModal.show();
  };

  const confirmCoffee = async () => {
    try {
      const amount = parseFloat(coffeeAmountInput.value);
      if (isNaN(amount) || amount <= 0) {
        log("❌ Invalid coffee amount", "red");
        return;
      }
      const tx = await signer.sendTransaction({
        to: "0xF57261...", // Ganti dengan alamat donasi
        value: ethers.utils.parseEther(amount.toString()),
      });
      log(`🚀 Coffee TX sent: ${tx.hash}`, "cyan");
      const receipt = await tx.wait(1);
      if (receipt.status === 1) {
        log(`✅ Coffee TX successful: ${tx.hash}`, "green");
      } else {
        log(`❌ Coffee TX failed: ${tx.hash}`, "red");
      }
      coffeeModal.hide();
    } catch (error) {
      log(`❌ Coffee TX error: ${error.message}`, "red");
    }
  };

  connectWalletButton.addEventListener("click", connectWallet);
  disconnectWalletButton.addEventListener("click", disconnectWallet);
  calculateTotalButton.addEventListener("click", calculateTotal);
  generateMainWalletButton.addEventListener("click", generateMainWallet);
  copyMainWalletButton.addEventListener("click", copyMainWallet);
  depositAndTransferButton.addEventListener("click", () => window.depositAndTransfer(provider, signer, connectedAddress, mainWallets, lastCalculatedTotal, chainId, log));
  buyMeCoffeeButton.addEventListener("click", buyMeCoffee);
  confirmCoffeeButton.addEventListener("click", confirmCoffee);
  chainSelect.addEventListener("change", () => chainId = chainSelect.value);

  await loadChains();
});
