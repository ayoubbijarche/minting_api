use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use std::str::FromStr;


#[derive(Accounts)]
pub struct PartiesTr<'info> {
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum TokenErr {
    #[msg("Not the owner")]
    YouNoTokenOwner,
}

pub fn founder_transfer(ctx: Context<PartiesTr>, amount: u64) -> Result<()> {
    let founder_wallet = Pubkey::from_str("9LuEd8Kv6a2X92UA3neEUpLU3FvE56MEDkSmudPnAFMM")
        .expect("Failed to parse founder wallet");
    require!(
        ctx.accounts.to.owner == founder_wallet,
        TokenErr::YouNoTokenOwner
    );
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.from.to_account_info(),
        to: ctx.accounts.to.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, amount)?;
    
    Ok(())
}
