// Shared Naira formatter used across ALL pages for consistent display.
// Amounts of ₦10,000+ collapse to compact form (10k / 1.2M / 3.4B); smaller
// amounts keep two decimals. Keeps long numbers from overflowing cards/tables.
export const fmtNaira = (n) => {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 10000) {
    return sign + '₦' + new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(abs);
  }
  return sign + '₦' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Same rules but without the ₦ symbol (for places that render the symbol separately).
export const fmtAmount = (n) => fmtNaira(n).replace('₦', '');
