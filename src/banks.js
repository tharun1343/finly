// Banks operating in India, grouped as the RBI classifies them.
// [display name, short name, IFSC prefix]; the prefix lets the app recognise a bank from its IFSC.
export const BANK_GROUPS = [
  ['Public sector banks', [
    ['State Bank of India', 'SBI', 'SBIN'], ['Punjab National Bank', 'PNB', 'PUNB'], ['Bank of Baroda', 'BoB', 'BARB'],
    ['Canara Bank', 'Canara', 'CNRB'], ['Union Bank of India', 'Union Bank', 'UBIN'], ['Bank of India', 'BOI', 'BKID'],
    ['Indian Bank', 'Indian Bank', 'IDIB'], ['Central Bank of India', 'Central Bank', 'CBIN'], ['Indian Overseas Bank', 'IOB', 'IOBA'],
    ['UCO Bank', 'UCO', 'UCBA'], ['Bank of Maharashtra', 'BoM', 'MAHB'], ['Punjab & Sind Bank', 'P&S Bank', 'PSIB']]],
  ['Private sector banks', [
    ['HDFC Bank', 'HDFC', 'HDFC'], ['ICICI Bank', 'ICICI', 'ICIC'], ['Axis Bank', 'Axis', 'UTIB'], ['Kotak Mahindra Bank', 'Kotak', 'KKBK'],
    ['IndusInd Bank', 'IndusInd', 'INDB'], ['Yes Bank', 'Yes Bank', 'YESB'], ['IDFC FIRST Bank', 'IDFC FIRST', 'IDFB'], ['IDBI Bank', 'IDBI', 'IBKL'],
    ['Federal Bank', 'Federal', 'FDRL'], ['South Indian Bank', 'SIB', 'SIBL'], ['Karur Vysya Bank', 'KVB', 'KVBL'], ['City Union Bank', 'CUB', 'CIUB'],
    ['Tamilnad Mercantile Bank', 'TMB', 'TMBL'], ['Karnataka Bank', 'Karnataka Bank', 'KARB'], ['RBL Bank', 'RBL', 'RATN'], ['Bandhan Bank', 'Bandhan', 'BDBL'],
    ['CSB Bank', 'CSB', 'CSBK'], ['DCB Bank', 'DCB', 'DCBL'], ['Dhanlaxmi Bank', 'Dhanlaxmi', 'DLXB'], ['Jammu & Kashmir Bank', 'J&K Bank', 'JAKA'],
    ['Nainital Bank', 'Nainital Bank', 'NTBL']]],
  ['Small finance banks', [
    ['AU Small Finance Bank', 'AU Bank', 'AUBL'], ['Equitas Small Finance Bank', 'Equitas', 'ESFB'], ['Ujjivan Small Finance Bank', 'Ujjivan', 'UJVN'],
    ['Jana Small Finance Bank', 'Jana', 'JSFB'], ['Suryoday Small Finance Bank', 'Suryoday', 'SURY'], ['ESAF Small Finance Bank', 'ESAF', 'ESMF'],
    ['Utkarsh Small Finance Bank', 'Utkarsh', 'UTKS'], ['Capital Small Finance Bank', 'Capital SFB', 'CLBL'], ['North East Small Finance Bank', 'NESFB', 'NESF'],
    ['Shivalik Small Finance Bank', 'Shivalik', 'SMCB'], ['Unity Small Finance Bank', 'Unity', 'UNBA'], ['slice Small Finance Bank', 'slice', 'NESF']]],
  ['Payments banks', [
    ['India Post Payments Bank', 'IPPB', 'IPOS'], ['Airtel Payments Bank', 'Airtel PB', 'AIRP'], ['Fino Payments Bank', 'Fino', 'FINO'],
    ['Jio Payments Bank', 'Jio PB', 'JIOP'], ['NSDL Payments Bank', 'NSDL PB', 'NSPB'], ['Paytm Payments Bank', 'Paytm PB', 'PYTM']]],
  ['Foreign banks', [
    ['Standard Chartered Bank', 'StanChart', 'SCBL'], ['HSBC', 'HSBC', 'HSBC'], ['DBS Bank India', 'DBS', 'DBSS'], ['Citibank', 'Citi', 'CITI'],
    ['Deutsche Bank', 'Deutsche', 'DEUT'], ['Barclays Bank', 'Barclays', 'BARC']]],
  ['Co-operative & regional banks', [
    ['Tamil Nadu State Apex Co-operative Bank', 'TNSC Bank', 'TNSC'], ['Saraswat Co-operative Bank', 'Saraswat', 'SRCB'], ['Cosmos Co-operative Bank', 'Cosmos', 'COSB'],
    ['TJSB Sahakari Bank', 'TJSB', 'TJSB'], ['SVC Co-operative Bank', 'SVC', 'SVCB'], ['Abhyudaya Co-operative Bank', 'Abhyudaya', 'ABHY'],
    ['Kerala Gramin Bank', 'KGB', 'KLGB'], ['Tamil Nadu Grama Bank', 'TN Grama', 'IDIB'], ['Karnataka Gramin Bank', 'Karnataka Gramin', 'PKGB'],
    ['Andhra Pradesh Grameena Vikas Bank', 'APGVB', 'SBIN']]]
];

export const OTHER_BANK = '__other';
const ALL = BANK_GROUPS.flatMap(([, list]) => list);
export const findBank = name => ALL.find(b => b[0] === name);
/** Regional banks share their sponsor's prefix; the main bank is listed first, so it wins. */
export const bankFromIfsc = ifsc => { const p = String(ifsc || '').slice(0, 4).toUpperCase(); return p.length === 4 ? ALL.find(b => b[2] === p) || null : null; };
export const shortName = name => findBank(name)?.[1] || name;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const last4 = acct => String(acct || '').slice(-4);
export const maskAcct = acct => '••••' + last4(acct);
