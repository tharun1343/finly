import { dayNum, addMonths, round2 } from './util.js';

/** Interest per year as a fraction: 2 % a month → 0.24. */
const yearlyRate = it => !it.interest ? 0 : (it.interest.rate / 100) * (it.interest.per === 'year' ? 1 : 12);

/** End of the tenure, or null when there is no fixed tenure. */
export const lendDue = it => it.tenure ? addMonths(it.date, it.tenure) : null;

/**
 * Where a lent/borrowed amount stands on a given day.
 * Simple interest on the principal still outstanding; each payment clears accrued interest first, then principal.
 */
export function lendState(it, asOf){
  const r = yearlyRate(it), end = dayNum(asOf);
  const accrue = (p, from, to) => r && to > from ? p * r * (to - from) / 365 : 0;
  let principal = it.amount, interest = 0, accrued = 0, paid = 0, t = dayNum(it.date);
  const pays = [...(it.payments || [])].sort((a, b) => dayNum(a.date) - dayNum(b.date));
  for(const p of pays){
    const d = dayNum(p.date); if(d > end) break;
    const a = accrue(principal, t, d); interest += a; accrued += a; t = Math.max(t, d);
    const toInterest = Math.min(p.amount, interest);
    interest -= toInterest; principal = Math.max(0, principal - (p.amount - toInterest)); paid += p.amount;
  }
  const a = accrue(principal, t, end); interest += a; accrued += a;
  return { principal: round2(principal), interest: round2(interest), outstanding: round2(principal + interest),
    accrued: round2(accrued), paid: round2(paid), monthly: round2(principal * r / 12) };
}

/** How a payment of `amount` on `date` would be split, and what is left after it. */
export function splitPayment(it, amount, date){
  const s = lendState(it, date), toInterest = Math.min(amount, s.interest), toPrincipal = Math.min(s.principal, amount - toInterest);
  return { before: s, toInterest: round2(toInterest), toPrincipal: round2(toPrincipal), after: round2(s.outstanding - amount) };
}

export const rateLabel = it => !it.interest ? 'No interest' : `${it.interest.rate}% per ${it.interest.per === 'year' ? 'year' : 'month'}`;
