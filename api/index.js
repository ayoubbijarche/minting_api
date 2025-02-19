require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const anchor = require("@coral-xyz/anchor");
const { web3 } = anchor;
const { 
  Keypair, 
  Connection, 
  PublicKey,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram
} = require("@solana/web3.js");
const { 
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} = require("@solana/spl-token");
const BN = require('bn.js');

const app = express();
app.use(cors());
app.use(express.json());

const SOLANA_NETWORK = "custom&customUrl=http%3A%2F%2Flocalhost%3A8899";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
const RPC_URL = "http://127.0.0.1:8899";

const connection = new Connection(RPC_URL, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: 60000
});

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.WALLET_PATH, 'utf-8')))
);

const provider = new anchor.AnchorProvider(
  connection,
  {
    publicKey: wallet.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(wallet);
      return tx;
    },
    signAllTransactions: async (txs) => {
      return txs.map((tx) => {
        tx.partialSign(wallet);
        return tx;
      });
    },
  },
  { commitment: 'confirmed' }
);

anchor.setProvider(provider);

function loadIdl() {
  const possiblePaths = [
    path.resolve(__dirname, '../target/idl/minting_api.json'),
    path.resolve(__dirname, '../programs/minting_api/target/idl/minting_api.json')
  ];

  for (const idlPath of possiblePaths) {
    try {
      if (fs.existsSync(idlPath)) {
        return JSON.parse(fs.readFileSync(idlPath, 'utf8'));
      }
    } catch (e) {
      console.log(`Failed to load IDL from ${idlPath}`);
    }
  }
  throw new Error('IDL file not found');
}

const idl = loadIdl();
console.log("Loaded IDL:", JSON.stringify(idl, null, 2));
console.log("Program ID:", PROGRAM_ID.toString());

let program;
try {
  program = new anchor.Program(idl, provider);
  console.log("Available program methods:", Object.keys(program.methods));
} catch (error) {
  console.error("Error initializing program:", error);
  process.exit(1);
}

const getMintAddress = () => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint")], 
    program.programId
  )[0];
};

const getMetadataAddress = (mint) => {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
      mint.toBuffer()
    ],
    new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
  )[0];
};

app.post('/token/create', async (req, res) => {
  try {
    const { name, symbol, uri, decimals = 7 } = req.body;

    if (!name || !symbol || !uri) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const mintKeypair = Keypair.generate();
    const metadataAddress = getMetadataAddress(mintKeypair.publicKey);

    const mintInfo = await connection.getAccountInfo(mintKeypair.publicKey);
    if (mintInfo) {
      return res.status(400).json({ error: "Mint already initialized!" });
    }

    console.log("Mint not found. Initializing Program...");

    const params = {
      name: name,
      symbol: symbol,
      uri: uri,
      decimals: decimals
    };

    const context = {
      metadata: metadataAddress,
      mint: mintKeypair.publicKey,
      payer: wallet.publicKey,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      tokenMetadataProgram: new web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
    };

    console.log("Creating token with params:", params);
    console.log("Generated addresses:", {
      mint: mintKeypair.publicKey.toString(),
      metadata: metadataAddress.toString()
    });

    const txHash = await program.methods
      .initToken(params)
      .accounts(context)
      .signers([mintKeypair])
      .rpc();

    await connection.confirmTransaction(txHash, "finalized");

    const newMintInfo = await connection.getAccountInfo(mintKeypair.publicKey);
    if (!newMintInfo) {
      throw new Error("Mint initialization failed - account not found");
    }

    console.log(`Transaction confirmed: https://explorer.solana.com/tx/${txHash}?cluster=${SOLANA_NETWORK}`);

    res.json({ 
      success: true, 
      mint: mintKeypair.publicKey.toString(),
      metadata: metadataAddress.toString(),
      txHash,
      explorerUrl: `https://explorer.solana.com/tx/${txHash}?cluster=${SOLANA_NETWORK}`
    });
  } catch (error) {
    console.error("Detailed error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
    res.status(400).json({ error: error.message });
  }
});

app.post('/token/mint', async (req, res) => {
    try {
        const { mint, amount } = req.body;

        if (!mint || !amount) {
            return res.status(400).json({ error: "Missing required parameters: mint and amount" });
        }

        const mintPubkey = new PublicKey(mint);
        const mintAuthority = wallet.publicKey;

        const destination = getAssociatedTokenAddressSync(
            mintPubkey,
            wallet.publicKey
        );

        let initialBalance = 0;
        try {
            const balance = await connection.getTokenAccountBalance(destination);
            initialBalance = balance.value.uiAmount;
            console.log("Initial balance:", initialBalance);
        } catch (e) {
            console.log("No initial balance found");
        }

        const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
        const decimals = mintInfo.value?.data.parsed.info.decimals || 0;
        
        const amountToMint = new anchor.BN(amount * Math.pow(10, decimals));

        console.log("Minting tokens...");
        console.log("Mint address:", mintPubkey.toString());
        console.log("Mint Authority:", mintAuthority.toString());
        console.log("Destination:", destination.toString());
        console.log("Amount:", amount);

        const transaction = new Transaction();

        transaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({ 
                units: 300000
            })
        );

        const ataInfo = await connection.getAccountInfo(destination);
        if (!ataInfo) {
            console.log("Creating Associated Token Account...");
            transaction.add(
                createAssociatedTokenAccountInstruction(
                    wallet.publicKey,
                    destination,
                    wallet.publicKey,
                    mintPubkey
                )
            );
        }

        const mintInstruction = await program.methods
            .mintTokens(amountToMint)
            .accounts({
                mint: mintPubkey,
                mintAuthority: mintAuthority,
                destination,
                payer: wallet.publicKey,
                rent: SYSVAR_RENT_PUBKEY,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .instruction();

        transaction.add(mintInstruction);

        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.feePayer = wallet.publicKey;

        transaction.sign(wallet);

        const txHash = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: true,
            maxRetries: 5
        });

        await connection.confirmTransaction({
            signature: txHash,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, 'confirmed');
        
        await new Promise(resolve => setTimeout(resolve, 5000));

        const postBalance = (
            await connection.getTokenAccountBalance(destination)
        ).value.uiAmount;

        const mintSupply = (await connection.getTokenSupply(mintPubkey)).value.uiAmount;

        const explorerUrl = `https://explorer.solana.com/tx/${txHash}?cluster=${SOLANA_NETWORK}`;
        console.log(`Transaction confirmed: ${explorerUrl}`);

        res.json({
            success: true,
            mint: mintPubkey.toString(),
            destination: destination.toString(),
            initialBalance,
            finalBalance: postBalance,
            mintSupply,
            amountMinted: amount,
            txHash,
            explorerUrl
        });

    } catch (error) {
        console.error("Detailed error:", error);
        if (error.logs) {
            console.error("Program logs:", error.logs);
        }
        res.status(400).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
  console.log('Program ID:', PROGRAM_ID.toString());
  console.log('Wallet public key:', wallet.publicKey.toString());
});
