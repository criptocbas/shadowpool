import anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const { AnchorProvider, Program, BN, Wallet } = anchor;

const RPC = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const PROGRAM_ID = new PublicKey("BEu9VWMdba4NumzJ3NqYtHysPtCWe1gB33SbDwZ64g4g");
const AUTHORITY = new PublicKey("5KUE3sm7pg2bicvGm8wtn1zyff4h57mmyxShhhiQjHc6");
const CLUSTER_OFFSET = 456;

// Fake wallet for building the tx; we only simulate
const dummy = Keypair.generate();
const provider = new AnchorProvider(conn, new Wallet(dummy), { commitment: "confirmed" });
const idl = JSON.parse(fs.readFileSync("app/src/idl/shadowpool.json", "utf8"));
const program = new Program(idl, provider);

const ARCIUM = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };
const derive = (seeds) => PublicKey.findProgramAddressSync(seeds, ARCIUM)[0];

const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), AUTHORITY.toBuffer()],
  PROGRAM_ID,
);
const compDefOffset = crypto.createHash("sha256").update("init_vault_state").digest().slice(0,4).readUInt32LE();
const computationOffsetBN = new BN(Buffer.from(crypto.randomBytes(8)));

const mxe = derive([Buffer.from("MXEAccount"), PROGRAM_ID.toBuffer()]);
const mempool = derive([Buffer.from("Mempool"), u32le(CLUSTER_OFFSET)]);
const execpool = derive([Buffer.from("Execpool"), u32le(CLUSTER_OFFSET)]);
const cluster = derive([Buffer.from("Cluster"), u32le(CLUSTER_OFFSET)]);
const compDef = derive([Buffer.from("ComputationDefinitionAccount"), PROGRAM_ID.toBuffer(), u32le(compDefOffset)]);
const compAcc = derive([
  Buffer.from("ComputationAccount"),
  u32le(CLUSTER_OFFSET),
  computationOffsetBN.toArrayLike(Buffer, "le", 8),
]);

const ct0 = new Array(32).fill(1);
const ct1 = new Array(32).fill(2);
const pk = new Array(32).fill(3);
const nonce = new BN("12345678901234567890");

const tx = await program.methods
  .createVaultState(computationOffsetBN, ct0, ct1, pk, nonce)
  .accountsPartial({
    authority: AUTHORITY,
    vault: vaultPda,
    computationAccount: compAcc,
    clusterAccount: cluster,
    mxeAccount: mxe,
    mempoolAccount: mempool,
    executingPool: execpool,
    compDefAccount: compDef,
  })
  .transaction();

tx.feePayer = AUTHORITY;
tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

console.log("Simulating with", tx.instructions[0].keys.length, "accounts…\n");
// web3.js 1.95.x: simulateTransaction(Transaction) uses provided blockhash
// but requires a signature. Use the raw JSON-RPC call to avoid sig.
const serialized = tx.serializeMessage().toString("base64");
const res = await fetch(RPC, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "simulateTransaction",
    params: [
      tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      { sigVerify: false, replaceRecentBlockhash: true, encoding: "base64" },
    ],
  }),
});
const json = await res.json();
const sim = json.result;
console.log("err:", JSON.stringify(sim.value.err));
console.log("logs:");
(sim.value.logs || []).forEach(l => console.log("  ", l));
