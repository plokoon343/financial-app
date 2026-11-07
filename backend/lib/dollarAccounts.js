'use strict';
// Dollar amounts (round 6, section 6.3; research doc 13.8).
//
// A dollar card is its own account, in USD. Naira totals may include a dollar
// charge ONLY when we know the real rate the user paid for those dollars - the
// naira they paid divided by the dollars they received on the most recent
// funding of that account. We never substitute a market or guessed rate: with
// no funding on record, the naira total says nothing about the charge, and the
// charge is shown on its own ("plus $9.99 on your dollar card").
//
// Pure and dependency-free.

function round2(n) { return Math.round(n * 100) / 100; }

// fundings: [{ nairaAmount, usdAmount, date }]. The most recent one (by date)
// wins; an older, better rate never overrides it, because the rate that matters
// is the one actually paid for the dollars being spent now.
function latestFunding(fundings) {
  const list = (fundings || []).filter((f) => f && Number(f.usdAmount) > 0 && Number(f.nairaAmount) > 0);
  if (!list.length) return null;
  return list.reduce((a, b) => (new Date(b.date).getTime() > new Date(a.date).getTime() ? b : a));
}

function effectiveRate(fundings) {
  const f = latestFunding(fundings);
  return f ? f.nairaAmount / f.usdAmount : null;
}

// One dollar charge, described for a transaction row and for the totals.
//   known rate:   { nairaAmount: number, includedInNairaTotal: true,  label: "$9.99 - about N16,983 at your rate" }
//   no rate known: { nairaAmount: null,   includedInNairaTotal: false, label: "$9.99" }
function describeDollarCharge(usdAmount, fundings) {
  const usd = Math.abs(Number(usdAmount) || 0);
  const rate = effectiveRate(fundings);
  const usdLabel = `$${usd.toFixed(2)}`;
  if (rate == null) {
    return { usdAmount: usd, nairaAmount: null, rate: null, includedInNairaTotal: false, label: usdLabel };
  }
  const naira = Math.round(usd * rate);
  return {
    usdAmount: usd,
    nairaAmount: naira,
    rate: round2(rate),
    includedInNairaTotal: true,
    label: `${usdLabel} · about ₦${naira.toLocaleString('en-NG')} at your rate`,
  };
}

// Fold a set of dollar charges into the naira totals, keeping the ones with no
// known rate separate rather than guessing at a rate for them.
// entries: [{ usdAmount, fundings }]
function totalsWithDollar(entries) {
  let nairaFromDollar = 0;
  let unconvertedUsd = 0;
  for (const e of entries || []) {
    const d = describeDollarCharge(e.usdAmount, e.fundings);
    if (d.includedInNairaTotal) nairaFromDollar += d.nairaAmount;
    else unconvertedUsd += d.usdAmount;
  }
  unconvertedUsd = round2(unconvertedUsd);
  return {
    nairaFromDollar,
    unconvertedUsd,
    unconvertedLabel: unconvertedUsd > 0 ? `plus $${unconvertedUsd.toFixed(2)} on your dollar card` : '',
  };
}

module.exports = { latestFunding, effectiveRate, describeDollarCharge, totalsWithDollar };
