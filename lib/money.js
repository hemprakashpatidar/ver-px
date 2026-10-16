// All ledger money is integer paise. The API speaks rupees (up to 2 decimals).

// Exact conversion from a rupee number with at most two decimals; 0.29 * 100 would give 28.999…
export const toPaise = (rupees) => {
  const [whole, fraction = ''] = Number(rupees).toFixed(2).split('.');
  return Number(whole) * 100 + Math.sign(Number(rupees) || 1) * Number(fraction.padEnd(2, '0'));
};

export const toRupees = (paise) => paise / 100;

// Splits amountPaise into `count` equal shares. Leftover paise go to the payer's share
// (index payerIndex), so nobody is ever asked to cover the payer's rounding.
export const splitEqually = (amountPaise, count, payerIndex = 0) => {
  const base = Math.floor(amountPaise / count);
  const remainder = amountPaise - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === payerIndex ? remainder : 0));
};
