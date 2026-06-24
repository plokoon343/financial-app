# Automonie — Cashflow / Monetization Map

A working list of every revenue source Automonie could realistically have, grouped by
revenue model and sorted into release phases. Edit freely — tick items as you commit to them.

**Compliance weight:** ✅ already built · 🟢 low · 🟡 moderate / needs a partner (PSP, insurer) · 🔴 licensed / CBN / SEC / NDPR
**Phase:** 1 = launch revenue (low friction) · 2 = recurring + light fintech · 3 = credit & B2B · 4 = neobank

---

## A. Transaction & commission revenue (usage-based)
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☑ | Bills commission — airtime / data | Reseller margin from VTpass (telco commissions) | 1 | ✅🟢 |
| ☑ | Bills commission — TV & electricity | Per-transaction commission | 1 | ✅🟢 |
| ☐ | More VAS — betting funding, gift cards, intl airtime, eSIM | Aggregator commission per txn | 1–2 | 🟢 |
| ☐ | Education pins (WAEC / JAMB / NECO), scratch cards | Fixed margin per pin | 1 | 🟢 |
| ☐ | Wallet funding fee | Small markup over PSP card/bank-funding cost | 2 | 🟡 |
| ☐ | Withdrawal / payout fee | Flat fee on wallet → bank transfers | 2 | 🟡 |
| ☐ | Virtual-account / collection fee | Per-inflow fee on dedicated accounts | 2 | 🟡 |
| ☐ | External transfer markup | Margin on send-to-bank | 2 | 🟡 |

## B. Subscription / SaaS (recurring — most durable revenue)
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☐ | **Pro plan** — unlimited imports, advanced reports, tax/PDF export, priority support | Monthly / annual sub | 1 | 🟢 |
| ☐ | **AI tier** — natural-language actions, auto-categorization, coaching | Higher sub or add-on (cost = Claude API) | 2 | 🟢 |
| ☐ | Family / household plan | Multi-member sub | 2 | 🟢 |
| ☐ | Business / SME tier — cashflow, multi-user, invoicing | Higher sub | 3 | 🟢 |
| ☐ | White-label / B2B — cooperatives, employers, payroll-linked savings | Per-seat licensing | 3 | 🟡 |

## C. Float / treasury / interest spread (balance-based)
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☑ | Savings-plan early-break fee (3%) | Fee on early withdrawal | 1 | ✅🟢 |
| ☐ | Net interest margin on savings plans | Earn more on deployed funds than the 10% paid out | 2 | 🟡 |
| ☐ | Wallet float yield | Invest idle balances, keep the spread | 2 | 🔴 |
| ☐ | Premium / locked high-yield products | Management cut on yield | 3 | 🔴 |
| ☐ | Dormancy / maintenance fee on inactive balances | Periodic fee | 2 | 🟡 |

## D. Lending & credit (later — licensed or via partner)
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☐ | Loan / insurance **referral** commission | Affiliate fee, no license needed | 1 | 🟢 |
| ☐ | Salary advance / micro-loans | Interest + origination fee | 3 | 🔴 |
| ☐ | BNPL on bills (pay later for electricity / TV) | Merchant + interest fee | 3 | 🔴 |
| ☐ | Wallet overdraft | Interest / fee | 3 | 🔴 |
| ☐ | Credit-builder product | Subscription + fees | 3 | 🟡 |

## E. Card & banking ("if we become a bank")
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☐ | Card issuance (virtual / physical) | Issuance fee | 4 | 🔴 |
| ☐ | Interchange on card spend | % of every card transaction | 4 | 🔴 |
| ☐ | Account maintenance / transfer charges | Regulated banking fees | 4 | 🔴 |
| ☐ | FX / USD card markup | Spread on FX | 4 | 🔴 |
| ☐ | Merchant acquiring / POS | MDR on merchant volume | 4 | 🔴 |

## F. Data, insights & B2B (consent-sensitive)
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☐ | Credit-scoring-as-a-service (consented txn data) | Sell scores to lenders | 3 | 🔴 |
| ☐ | Aggregated / anonymized spending insights | Sell to FMCG / research | 3 | 🔴 |
| ☐ | Lead-gen to banks / insurers / investment platforms | Per-qualified-lead fee | 2 | 🟡 |
| ☐ | Partner API access | Usage fees | 3 | 🟡 |

## G. Marketplace & ecosystem
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☐ | Investment products (T-bills, mutual funds) distribution | Distribution commission | 2–3 | 🔴 |
| ☐ | Insurance distribution (health, device, travel) | Commission | 2 | 🟡 |
| ☐ | Merchant-funded cashback | Keep a cut of the cashback | 2 | 🟢 |
| ☐ | Sponsored placements / featured offers | Ad / placement fee | 2 | 🟢 |

## H. One-off / ancillary
| ✓ | Source | How it earns | Phase | Weight |
|---|---|---|---|---|
| ☐ | Tax-report / year-end statement generation | Paid one-off | 1 | 🟢 |
| ☐ | SME onboarding / concierge | Paid setup | 3 | 🟢 |

---

## Phase rollup (by build effort × compliance)

**Phase 1 — Launch revenue (now, low friction)**
Bills/VAS commissions (✅), more VAS + education pins, early-break fee (✅), Pro plan v1,
referral commissions (loans/insurance), paid tax export.

**Phase 2 — Recurring + light fintech (PSP / partner)**
AI tier, family plan, wallet funding/withdrawal/virtual-account fees, insurance & cashback
marketplace, lead-gen, float interest margin (via partner), dormancy fee.

**Phase 3 — Credit & B2B (licensed / partner)**
Salary advance / BNPL / overdraft, SME tier, investment distribution, credit-scoring-as-a-service,
white-label.

**Phase 4 — Neobank ("if we become a bank")**
Card issuance + interchange, account/transfer fees, FX/USD cards, acquiring/POS.

---

## Watch-outs
- **The 🔴 wall:** anything touching deposits, lending, float yield, or cards needs CBN licensing
  (or a licensed sponsor/partner). That's the line between Phases 1–2 and 3–4.
- **Data monetization (F):** highest margin, highest reputational risk. Gate behind explicit
  consent (NDPR) or it can erode trust fast.
- **Keep the core free** long enough to build volume; monetize the edges (VAS, Pro, partners) first.
