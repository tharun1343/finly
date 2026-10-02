import { T, dayNum, fmtDate, fmtAmt, fmtMoney, round2 } from './util.js';

/** h = { cat, catLabel, itemPaid, itemRemaining, nextDue, histDesc } supplied by the app.
 *  Rows are grouped by commitment (in the order given), oldest payment first within each. */
export function paymentRows(items, r, mf, h){
  const rows = [];
  items.forEach((it, order) => {
    const c = h.cat(it.catId), isChit = it.kind === 'chit';
    for(const x of it.history || []){
      if(r.from && dayNum(x.date) < dayNum(r.from)) continue;
      if(r.to && dayNum(x.date) > dayNum(r.to)) continue;
      const desc = isChit ? `Round ${x.round} · ${h.histDesc(x, mf, false)}`
        : x.opening ? `Opening balance (${x.n} payments already made)` : it.ongoing ? 'Regular payment' : `Installment ${x.n} of ${it.tenureTotal}`;
      rows.push({ order, id:it.id, date:x.date, name:it.name, cat: h.catLabel(it), type: isChit ? 'Chit fund' : it.ongoing ? 'Bill' : 'EMI',
        status: it.status === 'active' ? 'Active' : 'Closed', desc, paid: isChit ? x.paid : x.amount, comm: isChit ? (x.share || 0) : 0,
        recv: isChit ? (x.received || 0) : 0, bid: isChit && x.type === 'taken' ? (x.bid || 0) : 0, late: x.lateFee || 0 });
    }
  });
  return rows.sort((a, b) => a.order - b.order || dayNum(a.date) - dayNum(b.date));
}

export function summaryRow(it, h){
  const c = h.cat(it.catId), isChit = it.kind === 'chit';
  return { name:it.name, cat: h.catLabel(it), type: isChit ? 'Chit fund' : it.ongoing ? 'Bill' : 'EMI', status: it.status === 'active' ? 'Active' : 'Closed',
    amount: isChit ? it.installment : it.amount, per: isChit ? (it.interval === 1 ? 'round (monthly)' : `round (every ${it.interval} months)`) : ({ 1:'month', 3:'quarter', 6:'6 months', 12:'year' }[it.every || 1]),
    progress: isChit ? `${it.roundsDone} of ${it.members} rounds${it.taken ? ` · taken in round ${it.taken.round}` : ' · not taken'}` : it.ongoing ? 'Ongoing' : `${it.tenureTotal - it.tenureLeft} of ${it.tenureTotal} ${(it.every || 1) === 1 ? 'months' : 'payments'} paid`,
    paid: h.itemPaid(it), remaining: h.itemRemaining(it), comm: isChit ? it.commission : 0, recv: isChit && it.taken ? it.taken.received : 0,
    date: it.status === 'closed' ? `Closed ${it.closedOn}` : `Next due ${h.nextDue(it)}` };
}

function csvCell(v){
  if(v == null) return '';
  let s = typeof v === 'number' ? String(round2(v)) : String(v);
  if(typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');

export function buildCsv(kind, items, r, h){
  if(kind === 'payments'){
    const rows = paymentRows(items, r, fmtMoney, h);
    return toCSV([['Commitment', 'Category', 'Type', 'Status', 'Date', 'Details', 'Paid (INR)', 'Late fee (INR)', 'Commission (INR)', 'Your bid (INR)', 'Received (INR)'],
      ...rows.map(p => [p.name, p.cat, p.type, p.status, p.date, p.desc, p.paid, p.late, p.comm, p.bid, p.recv])]);
  }
  return toCSV([['Commitment', 'Category', 'Type', 'Status', 'Amount (INR)', 'Per', 'Progress', 'Total paid (INR)', 'Remaining (INR)', 'Commission (INR)', 'Received (INR)', 'Next due / closed'],
    ...items.map(it => summaryRow(it, h)).map(s => [s.name, s.cat, s.type, s.status, s.amount, s.per, s.progress, s.paid, s.remaining, s.comm, s.recv, s.date])]);
}

const hexRgb = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
const tint = (rgb, k) => rgb.map(v => Math.round(v + (255 - v) * k));

export async function buildPdf(items, r, h, colors, user){
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit:'pt', format:'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const brand = hexRgb(colors.primary), gold = hexRgb(colors.gold), rose = hexRgb(colors.rose);
  const rs = n => 'Rs. ' + fmtAmt(n);
  const pays = paymentRows(items, r, rs, h), sums = items.map(it => summaryRow(it, h));

  doc.setFillColor(...brand); doc.rect(0, 0, W, 84, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.text('Finly', 40, 50);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(items.length === 1 ? `${items[0].name} - statement` : 'Commitments statement', W - 40, 44, { align:'right' });
  doc.setFontSize(9); doc.text(`Generated ${fmtDate(T)}`, W - 40, 60, { align:'right' });
  doc.setTextColor(70); doc.setFontSize(10);
  doc.text([user.name, user.email].filter(Boolean).join('  ·  '), 40, 110);
  doc.text(`Payments period: ${r.label}${r.from ? ` (${fmtDate(r.from)} – ${fmtDate(r.to)})` : ''}`, 40, 125);

  const kpis = [
    ['Paid in period', rs(pays.reduce((s, p) => s + p.paid, 0)), brand],
    ['Outstanding debt', rs(sums.reduce((s, x) => s + x.remaining, 0)), rose],
    ['Commission earned', rs(pays.reduce((s, p) => s + p.comm, 0)), gold],
    ['Commitments', String(items.length), brand]];
  const gap = 10, bw = (W - 80 - gap * 3) / 4;
  kpis.forEach(([l, val, col], i) => {
    const x = 40 + i * (bw + gap);
    doc.setFillColor(...tint(col, .9)); doc.roundedRect(x, 142, bw, 52, 6, 6, 'F');
    doc.setTextColor(100); doc.setFontSize(8); doc.text(l.toUpperCase(), x + 10, 160);
    doc.setTextColor(...col.map(c => Math.round(c * .75))); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.text(val, x + 10, 181); doc.setFont('helvetica', 'normal');
  });

  const base = { theme:'grid', styles:{ fontSize:8.5, cellPadding:5, lineColor:[226, 229, 238], lineWidth:.5, textColor:[40, 44, 60] },
    headStyles:{ fillColor:brand, textColor:255, fontStyle:'bold' }, alternateRowStyles:{ fillColor:[248, 249, 252] }, margin:{ left:40, right:40, bottom:46 } };
  doc.setTextColor(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Commitments', 40, 222);
  autoTable(doc, { ...base, startY:230,
    head:[['Commitment', 'Type', 'Status', 'Progress', 'Paid', 'Remaining']],
    body: sums.map(s => [`${s.name}\n${s.cat}`, s.type, s.status, s.progress, rs(s.paid), s.remaining ? rs(s.remaining) : '-']),
    columnStyles:{ 4:{ halign:'right' }, 5:{ halign:'right' } } });

  // One payments table per commitment, so each item's history reads on its own.
  let y = doc.lastAutoTable.finalY + 30;
  const heading = (title, sub) => {
    if(y > H - 120){ doc.addPage(); y = 50; }
    doc.setTextColor(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.text(title, 40, y);
    if(sub){ doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110); doc.text(sub, 40, y + 13); y += 13; }
  };
  if(y > H - 90){ doc.addPage(); y = 50; }
  doc.setTextColor(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Payments by commitment', 40, y); y += 24;
  if(!pays.length){ doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110); doc.text('No payments in this period.', 40, y - 4); }
  items.forEach((it, i) => {
    const rows = pays.filter(p => p.id === it.id), s = sums[i], isChit = it.kind === 'chit';
    heading(it.name, [s.cat, s.type, s.status, s.progress].filter((v, k, a) => v && a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === k).join(' · '));
    if(!rows.length){ doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(130); doc.text('No payments in this period.', 40, y + 16); y += 40; return; }
    const sum = k => rows.reduce((t, p) => t + p[k], 0);
    const anyLate = rows.some(p => p.late), anyBid = rows.some(p => p.bid), anyRecv = rows.some(p => p.recv);
    const cols = [['Date', p => fmtDate(p.date)], ['Details', p => p.desc], ['Paid', p => rs(p.paid), 'paid'],
      ...(anyLate ? [['Late fee', p => p.late ? rs(p.late) : '-', 'late']] : []),
      ...(isChit ? [['Commission', p => p.comm ? rs(p.comm) : '-', 'comm']] : []),
      ...(anyBid ? [['Your bid', p => p.bid ? rs(p.bid) : '-', 'bid']] : []),
      ...(anyRecv ? [['Received', p => p.recv ? rs(p.recv) : '-', 'recv']] : [])];
    const money = { halign:'right', cellWidth: cols.length > 4 ? 62 : 80, overflow:'visible' };
    const right = Object.fromEntries(cols.map((c, k) => [k, k >= 2 ? money : {}]));
    autoTable(doc, { ...base, startY: y + 8,
      head:[cols.map(c => c[0])],
      body: rows.map(p => cols.map(c => c[1](p))),
      foot:[cols.map((c, k) => k === 1 ? `Total · ${rows.length} payment${rows.length === 1 ? '' : 's'}` : c[2] ? { content: rs(sum(c[2])), styles:{ halign:'right' } } : '')],
      footStyles:{ fillColor:tint(brand, .88), textColor:[30, 34, 50], fontStyle:'bold' }, showFoot:'lastPage',
      columnStyles:{ ...right, 0:{ cellWidth:70 } } });
    y = doc.lastAutoTable.finalY + 26;
  });

  const n = doc.internal.getNumberOfPages();
  for(let i = 1; i <= n; i++){
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.setFont('helvetica', 'normal');
    doc.text('Finly · amounts in Indian Rupees (Rs.)', 40, H - 22); doc.text(`Page ${i} of ${n}`, W - 40, H - 22, { align:'right' });
  }
  return doc.output('blob');
}
