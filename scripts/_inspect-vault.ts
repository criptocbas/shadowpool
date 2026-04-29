import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { Shadowpool } from "../target/types/shadowpool";
import * as fs from "fs"; import * as os from "os";

(async () => {
  const conn = new Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const owner = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8"))));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(owner), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = anchor.workspace.Shadowpool as Program<Shadowpool>;
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.publicKey.toBuffer()], program.programId);
  const v: any = await program.account.vault.fetch(vaultPda);
  const allZero = v.encryptedState.every((ct: number[]) => ct.every((b: number) => b === 0));
  console.log(`Vault @ ${vaultPda.toBase58()}`);
  console.log(`  authority:                  ${v.authority.toBase58()}`);
  console.log(`  cranker:                    ${v.cranker.toBase58()}`);
  console.log(`  state_nonce:                ${v.stateNonce.toString()}`);
  console.log(`  encrypted_state all-zero?:  ${allZero}`);
  console.log(`  pending_state_computation:  ${v.pendingStateComputation ? v.pendingStateComputation.toString() : "None"}`);
  console.log(`  nav_stale:                  ${v.navStale}`);
  console.log(`  quotes_consumed:            ${v.quotesConsumed}`);
  console.log(`  total_shares:               ${v.totalShares.toString()}`);
  console.log(`  total_deposits_b:           ${v.totalDepositsB.toString()}`);
  console.log(`  last_revealed_nav:          ${v.lastRevealedNav.toString()}`);
})().catch(e => { console.error(e); process.exit(1); });
