import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MintingApi } from "../target/types/minting_api";
import { web3 } from "@coral-xyz/anchor";
import BN = require("@coral-xyz/anchor");
import { assert } from "chai";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction 
} from "@solana/spl-token";

describe("minting_api", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.MintingApi as Program<MintingApi>;
  const metadata_seed = "metadata"
  const token_metadata_program_id = new web3.PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
  )
  
  const mint_seed = "mint";
  const payer = program.provider.publicKey;
  const metadata = {
    name : "Token name",
    symbol : "Token symbol",
    uri : "metadata pointer using pinata",
    decimals : 7 // number of digits
  }
  
  const [mint] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(mint_seed)], 
    program.programId
  );
  
  const [metadataAddress] = web3.PublicKey
    .findProgramAddressSync([
      Buffer.from("metadata"),
      token_metadata_program_id.toBuffer(),
      mint.toBuffer()
    ], 
    token_metadata_program_id
  );
  
  const mint_addr = new anchor.web3.PublicKey("Dazs8dzwT7iR55L576WRaijEBF6RMJUHskErrFx4fwJ9");
  const recipientPublicKey = new anchor.web3.PublicKey("8E1TjSr2jTPXDMiHFBDytLQS2orkmzTmgM29itFvs66g");
  const recipientTokenAccount = getAssociatedTokenAddressSync(mint_addr, recipientPublicKey);
  const senderPublicKey = new anchor.web3.PublicKey("3EqDtdVGZistkvBr4gchmjVeqdCHYdUuVLQSMtPM2bTD");
  const senderTokenAccount = getAssociatedTokenAddressSync(mint_addr, senderPublicKey);
  

  init_token(program, mint, metadataAddress, payer, token_metadata_program_id, metadata)
  //mint_token(mint, payer, program, metadata, 1000000 /*number of supply*/)
  //transfer_to_founder(mint_addr, program, payer, metadata, senderTokenAccount, 1000000)

});



function init_token(program , mint , metadataAddress , payer , token_metadata_program_id , metadata){
    it("Initialize", async () => {
      const info = await program.provider.connection.getAccountInfo(mint);
      if (info) {
        console.log("already initialized!")
        return; 
      }
      console.log("Mint not found. Initializing Program...");
    
      const context = {
        metadata: metadataAddress,
        mint,
        payer,
        rent: web3.SYSVAR_RENT_PUBKEY,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        tokenMetadataProgram: token_metadata_program_id,
      };
    
    
      const txHash = await program.methods
        .initToken(metadata)
        .accounts(context)
        .rpc();
      await program.provider.connection.confirmTransaction(txHash, "finalized");
      console.log(`  https://explorer.solana.com/tx/${txHash}?cluster=devnet`);
      const newInfo = await program.provider.connection.getAccountInfo(mint);
      assert(newInfo, "  Mint should be initialized.");
    });
}



function mint_token(mint , payer , program , metadata , supply){
  it("mint tokens", async () => {
        const destination = await anchor.utils.token.associatedAddress({
          mint: mint,
          owner: payer,
        });
  
        let initialBalance = 0;
        try {
          const balance = await program.provider.connection.getTokenAccountBalance(destination);
          initialBalance = balance.value.uiAmount;
          console.log(`  Initial balance: ${initialBalance}`);
        } catch (e) {
          console.log("  No initial balance found");
        }
    
        const context = {
          mint,
          destination,
          payer,
          rent: web3.SYSVAR_RENT_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        };
    
        const amountToMint = supply;
        const amount = new anchor.BN(amountToMint * Math.pow(10, metadata.decimals));
        
        const txHash = await program.methods
          .mintToken(amount)
          .accounts(context)
          .rpc();
        await program.provider.connection.confirmTransaction(txHash);
        console.log(`  https://explorer.solana.com/tx/${txHash}?cluster=devnet`);
    
        await new Promise(resolve => setTimeout(resolve, 2000));
    
        const postBalance = (
          await program.provider.connection.getTokenAccountBalance(destination)
        ).value.uiAmount;
        
        console.log(`  Final balance: ${postBalance}`);
        assert.equal(
          postBalance, 
          initialBalance + amountToMint, 
          "Balance should be increased by exactly 2 tokens"
        );
      });
}


function transfer_to_founder(mint_addr , program , payer , metadata , senderTokenAccount , tk){
  it("transfers tokens to the founder's ATA", async () => {
    
    const founderWallet = new web3.PublicKey("5w3VpTacYmcCBXygAxFoCDfG4R11q9dbj4WGLVswweKE");
    const recipientAta = getAssociatedTokenAddressSync(mint_addr, founderWallet);
    
      try {
        const accountInfo = await program.provider.connection.getAccountInfo(recipientAta);
        if (!accountInfo) {
          console.log("ATA does not exist. Creating ATA...");
          const createAtaIx = createAssociatedTokenAccountInstruction(
            payer,          // payer of the transaction
            recipientAta,   // the ATA to be created
            founderWallet,  // owner of the ATA
            mint_addr       // token mint
          );
          const createAtaTx = new web3.Transaction().add(createAtaIx);
          await program.provider.sendAndConfirm(createAtaTx);
          console.log("Created founder's associated token account");
        } else {
          console.log("Found existing ATA for founder.");
        }
      } catch (e) {
        console.error("Error checking ATA; attempting to create:", e);
        const createAtaIx = createAssociatedTokenAccountInstruction(
          payer,
          recipientAta,
          founderWallet,
          mint_addr
        );
        const createAtaTx = new web3.Transaction().add(createAtaIx);
        await program.provider.sendAndConfirm(createAtaTx);
      }
    
  

      const amountToMint = tk;
      const amount = new anchor.BN(amountToMint * Math.pow(10, metadata.decimals));
      
      const txSignature = await program.methods
        .transferFounder(amount)
        .accounts({
          from: senderTokenAccount,
          to: recipientAta,
          authority: payer,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
        })
        .rpc();
      console.log(`Transfer successful: https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
    });
}


