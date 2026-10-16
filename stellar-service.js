const crypto = require("crypto");
const {
  BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc
} = require("@stellar/stellar-sdk");

function configured() {
  return Boolean(process.env.STELLAR_ADMIN_SECRET && process.env.STELLAR_CONTRACT_ID);
}
function shaBuffer(hex) { return Buffer.from(hex, "hex"); }
function scBytes32(hex) { return nativeToScVal(shaBuffer(hex), { type: "bytes" }); }
function scAddress(address) { return nativeToScVal(address, { type: "address" }); }
function scU32(value) { return nativeToScVal(Number(value), { type: "u32" }); }

async function invoke(method, args) {
  if (!configured()) return { registered: false, status: "not_configured", message: "Contrato Stellar no configurado" };
  const signer = Keypair.fromSecret(process.env.STELLAR_ADMIN_SECRET);
  const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
  const server = new rpc.Server(process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org");
  const contract = new Contract(process.env.STELLAR_CONTRACT_ID);
  const account = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status !== "PENDING") throw new Error(`Stellar rechazó la transacción: ${sent.status}`);
  const finalResult = await server.pollTransaction(sent.hash, { attempts: 20, sleepStrategy: () => 1000 });
  if (finalResult.status !== "SUCCESS") throw new Error(`La transacción no se confirmó: ${finalResult.status}`);
  return { registered: true, status: "registered", txHash: sent.hash, contractId: process.env.STELLAR_CONTRACT_ID };
}

async function issueTicket({ ticketHash, holderHash, eventId }) {
  const signer = Keypair.fromSecret(process.env.STELLAR_ADMIN_SECRET);
  return invoke("issue", [
    scAddress(signer.publicKey()), scBytes32(ticketHash), scBytes32(holderHash), scU32(eventId)
  ]);
}

async function initializeContract() {
  const signer = Keypair.fromSecret(process.env.STELLAR_ADMIN_SECRET);
  return invoke("initialize", [scAddress(signer.publicKey())]);
}

function makeHashes(ticketId, email, orderId) {
  const ticketHash = crypto.createHash("sha256").update(ticketId).digest("hex");
  const salt = process.env.TICKET_HASH_SALT || "development-only-change-me";
  // Se registra un hash seudónimo; nunca el correo o nombre en texto plano.
  const holderHash = crypto.createHash("sha256").update(`${salt}|${email}|${orderId}`).digest("hex");
  return { ticketHash, holderHash };
}

module.exports = { configured, invoke, issueTicket, initializeContract, makeHashes };
