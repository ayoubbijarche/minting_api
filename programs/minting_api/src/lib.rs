use anchor_lang::prelude::*;
pub mod instructions;
use instructions::*;

declare_id!("84QNYzZjpSmsRriLzrq7M1Vh8MD1yQogUt77TvuLsKwN");

#[program]
pub mod minting_api {
    use super::*;

    pub fn init_token(
        ctx: Context<InitToken>,
        params: InitTokenParams,
    ) -> Result<()> {
        msg!("Initializing token with params: {:?}", params);
        initiate_token(ctx, params)
    }
    
    pub fn mint_tokens(
        ctx: Context<MintTokens>,
        amount: u64,
    ) -> Result<()> {
        mint_tokens(ctx, amount);
        Ok(())
    }
}

