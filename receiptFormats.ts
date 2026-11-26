import type { IdentifierType } from './receiptReview.ts';

const authorityHeading = String.raw`(?:REVENUE[ -]+(?:COLLECTOR['’]S[ -]+)?RECEIPT|(?:TREASURY|PERSONAL[ -]+INCOME[ -]+TAX|TAX|OFFICIAL)[ -]+RECEIPT)`;
export const stateReceiptHeading = new RegExp(String.raw`^(?:[ \t]*(?:OYO|ONDO|DELTA|YOBE)[ _-]+STATE[^\n]{0,75}\n)?[ \t]*(?:E[- ]?)?${authorityHeading}(?:[ \t].*)?$`, 'gim');
const receiptEvidence = new RegExp(String.raw`\b(?:${authorityHeading}|PAYMENT[ \t]+RECEIPT|RECEIPT[ \t]*(?:NUMBER|NO\.?|ID)\s*[:#=])`, 'i');
const unpaidStatus = /(?:^|\n)[ \t]*(?:payment[ \t]+)?status[ \t]*[:=-]?[ \t]*(?:unpaid|pending|failed|declined|not[ \t]+paid)\b/i;
const supportHeading = /^[ \t]*(?:(?:remita |tax |payment )?invoice|assessment notice|(?:bank |cash )?deposit slip|bank teller(?: slip)?|payment (?:advice|instruction|request|acknowledgement)|remita payment request|tax bill|debit advice)[ \t]*$/im;
const paidEvidence = /\b(?:total[ \t]+(?:amount[ \t]+)?paid|amount[ \t]+paid|date[ \t]+paid|paid[ \t]+successfully|payment[ \t]+successful|status[ \t]*[:=-]?[ \t]*paid)\b/i;

export const isSupportingDocument = (text: string) =>
    unpaidStatus.test(text) || (supportHeading.test(text) && !receiptEvidence.test(text) && !paidEvidence.test(text));

const receiptId = String.raw`[A-Z0-9]+(?:[ \t]*[-/][ \t]*[A-Z0-9]+)*`;
const date = String.raw`(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?[ ./-]+(?:[A-Z]{3,9}|\d{1,2})[ ./,-]+\d{2,4})\b`;
const money = String.raw`(?:\d{1,3}(?:(?:[ \t]*,[ \t]*|[ \t]+)\d{3})+|\d{1,11})(?:[ \t]*[.,][ \t]*\d{2})?(?![\d.,])`;
const currency = String.raw`(?:NGN|NGA|₦|=N=|N)[ \t]*:?[ \t]*(?:\n[ \t]*)?`;
const paymentDateLabel = 'payment[ \t]+date|date[ \t]+of[ \t]+payment|transaction[ \t]+date|date[ \t]+paid|paid[ \t]+on';
const printedIdLabel = 'receipt[ \t]*(?:number|no\\.?|id|#)';
const paidAmountLabel = 'total[ \t]+(?:a(?:mount|rrount)[ \t]+)?paid|amount[ \t]+paid|payment[ \t]+amount';
const payerLabel = 'payer[ \t]+name|paid[ \t]+by|received[ \t]+from|customer[ \t]+name|taxpayer[ \t]+name';
const periodLabel = /(?:^|\n)[ \t]*(?:payment[ \t]+period|tax[ \t]+period|period(?:[ \t]+covered)?|description|narration|being|payment[ \t]+for|file[ \t]+no\.?)[ \t]*[:;#=-]?[ \t]*([^\n]{1,160})/gim;
const month = String.raw`Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?`;
const explicitPeriod = new RegExp(String.raw`\b(Q[1-4][ \t-]+(?:19|20)\d{2}|(?:${month})[ \t.,/'’_-]*(?:(?:19|20)\d{2}|\d{2})\b|\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})`, 'i');

const field = (text: string, label: string, value: string) =>
    text.match(new RegExp(String.raw`\b(?:${label})(?![A-Z])(?:[ \t]*[:;#=.-])?[ \t]*(?:\n[ \t]*)?(${value})`, 'i'))?.[1]?.trim() || '';

const numericAmount = (value: string) => Number(value.replace(/,\s*(\d{2})$/, '.$1').replace(/[ ,\t]/g, '')) || undefined;
const labelledAmount = (text: string, labels: string) => numericAmount(field(text, labels, String.raw`(?:${currency})?${money}`).replace(new RegExp('^' + currency, 'i'), ''));
const identifier = (value: string) => value.replace(/[ \t]/g, '').toUpperCase();
const namedRef = (text: string, pattern: RegExp) => identifier(text.match(pattern)?.[0] ?? '');

const treasuryBillPattern = /\b(?:treasury[ \t]+bills?|t[ \t-]*bills?|TB['’]?s)\b/i;
const oyoTax = (text: string) => {
    const evidence = new Set<string>();
    for (const line of text.split('\n')) {
        if (!/\b(?:revenue[ \t]+(?:item|code)|rev(?:enue)?\.?[ \t]+office|tax[ \t]+type)\b|^[ \t]*(?:being|narration|description|payment[ \t]+for)\b/i.test(line)) continue;
        if (/\b(?:WHT|WTH|withholding[ \t]+tax)\b/i.test(line)) evidence.add('WHT');
        if (/\b(?:PAYE|pay[ \t-]+as[ \t-]+you[ \t-]+earn)\b/i.test(line)) evidence.add('PAYE');
    }
    if (evidence.size > 1) return { taxType: '', taxConflict: true };
    const taxType = [...evidence][0];
    return taxType ? { taxType, remarks: taxType === 'WHT' && treasuryBillPattern.test(text) ? 'WHT on Treasury Bills' : taxType } : {};
};

interface ReceiptFormat {
    state: string;
    receiptNumber?: string;
    identifierType?: IdentifierType;
    paymentDate?: string;
    paymentPeriod?: string;
    companyName?: string;
    taxType?: string;
    remarks?: string;
    amount?: number;
    taxConflict?: boolean;
    dateFromIssue?: boolean;
    qrConflict?: boolean;
}

const treasuryDate = (text: string, issueDateFromReference = '') => {
    const paid = field(text, paymentDateLabel, date);
    const issued = field(text, 'dat(?:e|\\.)[ \t]+of[ \t]+(?:issue|tssue)|issued[ \t]+on', date) || issueDateFromReference;
    return { paymentDate: paid || issued, dateFromIssue: !paid && Boolean(issued) };
};

const deltaQrPattern = /^(?:Assessment Ref:[ \t]*N\/A[ \t]+)?Payment Ref:[ \t]*DTS\/[A-Z0-9]+\/[A-Z0-9]+\/(\d{2})(\d{2,4})\/[A-Z0-9/]+[ \t]+Receipt Number:[ \t]*(\d{19,32})[ \t]+Customer Name:[ \t]*([^\n\r]{1,160}?)[ \t]+Payment Amount:[ \t]*(\d{1,11}\.\d{2})(?:[ \t]*TransactionReference:[ \t]*\d+)?$/i;

export const decodeDeltaReceiptPayload = (payload: string) => {
    const parsed = payload.length <= 512 ? payload.trim().match(deltaQrPattern) : null;
    if (!parsed) return '';
    const [, year, encoded, reference, payer, amount] = parsed;
    const possibleDates = new Set<string>();
    for (const monthLength of [1, 2]) {
        const dayPart = encoded.slice(monthLength);
        if (!/^\d{1,2}$/.test(dayPart)) continue;
        const m = Number(encoded.slice(0, monthLength));
        const d = Number(dayPart);
        const candidate = new Date(Date.UTC(2000 + Number(year), m - 1, d));
        if (candidate.getUTCMonth() + 1 === m && candidate.getUTCDate() === d) {
            possibleDates.add(candidate.toISOString().slice(0, 10));
        }
    }
    const paymentDate = possibleDates.size === 1 ? [...possibleDates][0] : '';
    return ['Delta QR reference: ' + reference, 'Delta QR payer: ' + payer, 'Delta QR amount: ' + amount,
        paymentDate ? 'Delta QR date: ' + paymentDate : ''].filter(Boolean).join('\n');
};

const treasuryReferences: Record<string, RegExp> = {
    adamawa: /\bAD[ \t]*\/[ \t]*\d{5,8}\b/i,
    kebbi: /\b(?:PIT[ \t]*\d{5,18}|IRS\d{8,20})\b/i,
    sokoto: /\bRCP-20\d{6}-[A-Z0-9]{5,9}\b/i,
    taraba: /\bTR[ \t]*\/[ \t]*\d{4,8}\b/i,
    jigawa: /\bJG[ \t]*\/[ \t]*\d{4,8}\b/i
};

export const extractReceiptFormat = (text: string): ReceiptFormat | undefined => {
    const header = text.slice(0, 1600);
    const receipt = receiptEvidence.test(text);
    const explicitReceipt = identifier(field(text, printedIdLabel, receiptId));
    const printedNumber = /\d/.test(explicitReceipt) ? explicitReceipt : '';
    const amountPaid = labelledAmount(text, paidAmountLabel);
    const documentDate = field(text, paymentDateLabel, date);
    const payer = field(text, payerLabel, '[A-Z][^\\n:]{1,130}?(?=[ \\t]+\\b(?:TIN|Address|Payment Date|Total Amount)\\b|$|\\n)');
    const period = (value: string) => value.match(explicitPeriod)?.[1];
    const paymentPeriod = [...text.matchAll(periodLabel)].map(match => period(match[1])).find(Boolean) || period(payer);

    if (/\bANAMBRA[ _-]+STATE[ _-]+(?:IGR|INTERNAL[ \t]+REVENUE)\b/i.test(header) && receipt) {
        return { state: 'Anambra', receiptNumber: printedNumber || undefined, identifierType: printedNumber ? 'Receipt Number' : undefined,
            companyName: payer, paymentDate: documentDate, amount: amountPaid, paymentPeriod };
    }
    if (/\b(?:KWIRS|KWARA[ \t]+IRS)\b/i.test(header) && receipt) {
        const officialPaye = /\bPAYE[ \t]+Recoverables\b/i.test(text);
        const whtNarration = /\b(?:W[ \t]*H[ \t]*T|withholding[ \t]+tax)\b/i.test(payer);
        return {
            state: 'Kwara', receiptNumber: printedNumber || undefined, identifierType: printedNumber ? 'Receipt Number' : undefined,
            companyName: payer, paymentDate: documentDate, amount: amountPaid, paymentPeriod,
            ...(officialPaye && whtNarration ? { taxType: '', taxConflict: true } : {})
        };
    }
    const deltaQR = field(text, 'delta qr reference', '\\d{19,32}\\b');
    if (deltaQR || (/\bDELTA[ _-]+STATE\b|\bDELTABIR\b/i.test(header) && (receipt || /\bTreasury[ \t]+Book\b/i.test(text)))) {
        const printed = field(text, printedIdLabel, '\\d(?:[ \\t]*\\d){18,31}(?![ \\t]*\\d)').replace(/[ \t]/g, '');
        const qrPayer = field(text, 'delta qr payer', '[^\\n]+');
        const qrAmount = labelledAmount(text, 'delta qr amount');
        const qrDate = field(text, 'delta qr date', date);
        const reference = printed || deltaQR;
        return {
            state: 'Delta', receiptNumber: reference, identifierType: reference ? 'Receipt Number' : 'Missing',
            companyName: qrPayer || payer, paymentPeriod: period(qrPayer) || paymentPeriod,
            paymentDate: documentDate || qrDate || field(text, 'date', date),
            amount: amountPaid ?? qrAmount ?? labelledAmount(text, 'amount'),
            qrConflict: Boolean((printed && deltaQR && printed !== deltaQR) || (amountPaid && qrAmount && amountPaid !== qrAmount)
                || (documentDate && qrDate && /^\d{4}-\d{2}-\d{2}$/.test(documentDate) && documentDate !== qrDate))
        };
    }
    const yobe = namedRef(text, /\b20\d{2}[ \t]*\/[ \t]*\d{1,2}[ \t]*\/[ \t]*YB[ \t]*\/[ \t]*\d{3,8}\b/i);
    if (yobe && (receipt || amountPaid)) {
        return { state: 'Yobe', receiptNumber: yobe, identifierType: 'Receipt Number', companyName: payer, paymentDate: documentDate, amount: amountPaid, paymentPeriod };
    }
    if (/\b(?:PLATEAU(?:[ \t]+STATE)?|PSIRS)\b/i.test(text) && /\bBilling[ \t]+Ref(?:erence)?\b/i.test(text) && paidEvidence.test(text)) {
        const billingReference = field(text, 'billing[ \t]+ref(?:erence)?(?:[ \t]+(?:no\\.?|number))?', '\\d{9,13}\\b');
        // Some Plateau scans extract the table labels as a column, followed by its values.
        const columnAmount = numericAmount(text.match(new RegExp(String.raw`^[ \t]*NGN[ \t]+(${money})[ \t]*$`, 'im'))?.[1] ?? '');
        const columnPeriod = text.match(/^[ \t]*(\d{4}-\d{2}-\d{2})[ \t]+-[ \t]+\d{4}-\d{2}-\d{2}[ \t]*$/m)?.[1];
        return { state: 'Plateau', receiptNumber: printedNumber || billingReference || undefined, identifierType: printedNumber ? 'Receipt Number' : billingReference ? 'Billing Reference' : undefined, companyName: payer, paymentDate: documentDate, amount: amountPaid ?? labelledAmount(text, 'amount') ?? columnAmount, paymentPeriod: paymentPeriod || columnPeriod };
    }
    if (/\bONDO[ _-]+STATE\b/i.test(header) && receipt) {
        const reference = printedNumber || namedRef(text, /\bA0{4,10}\d{4,8}\b/i);
        const transactionId = field(text, 'transaction[ \t]+id', '\\d{6,20}\\b');
        const revenueAmount = numericAmount(text.match(new RegExp(String.raw`\bTransaction[ \t]+ID[^\n]{0,100}?${currency}(${money})`, 'i'))?.[1] ?? '');
        return { state: 'Ondo', receiptNumber: reference || transactionId, identifierType: reference ? 'Receipt Number' : transactionId ? 'Transaction Reference' : 'Missing', companyName: payer, paymentDate: documentDate, amount: amountPaid ?? labelledAmount(text, 'amount') ?? revenueAmount, paymentPeriod };
    }
    if (/\bOYO[ _-]+STATE[ _-]+GOVERNMENT\b/i.test(header) && receipt) {
        const reference = printedNumber || text.match(/^[ \t]*No[. \t]*[:#;][ \t]*(\d{10,29})\b/im)?.[1] || '';
        const bankDate = text.match(/\b[A-Z]{2,10}[ \t]*\|[ \t]*BRH[ \t]*\|[ \t]*OYMC[ \t]*\|[ \t]*(\d{1,2}[-.]\d{1,2}[-.]20\d{2})[ \t]*\|/i)?.[1];
        const beforeAmount = text.match(new RegExp(String.raw`^[ \t]*(${money})[ \t]*(?:[«<]|[^\n]*Naira\b)`, 'im'))?.[1] ?? '';
        return { state: 'Oyo', receiptNumber: reference, identifierType: reference ? 'Receipt Number' : 'Missing', companyName: payer, paymentDate: documentDate || bankDate || field(text, 'date', date), amount: amountPaid ?? labelledAmount(text, 'amount') ?? numericAmount(beforeAmount), paymentPeriod, ...oyoTax(text) };
    }
    const state = header.match(/\b(Adamawa|Kebbi|Sokoto|Taraba|Jigawa)[ _-]+State\b/i)?.[1] ||
        (/\bDamawa[ _-]+State\b/i.test(header) && treasuryReferences.adamawa.test(header) ? 'Adamawa' : '');
    if (state && /\b(?:treasury|personal[ \t]+income[ \t]+tax|revenue[ \t]+collector)\b/i.test(text) && /\breceipt\b/i.test(text)) {
        const key = state.toLowerCase();
        const reference = namedRef(header, treasuryReferences[key]) || printedNumber;
        const sokotoAmount = key === 'sokoto'
            ? numericAmount(text.match(new RegExp(String.raw`^[ \t]*(?:AV|${currency})[ \t]+(${money})[ \t]*$`, 'im'))?.[1] ?? '')
            : undefined;
        const encodedDate = key === 'sokoto' ? reference.match(/^RCP-(20\d{2})(\d{2})(\d{2})-/)?.slice(1).join('-') : '';
        return { state: state[0].toUpperCase() + state.slice(1).toLowerCase(), receiptNumber: reference, identifierType: reference ? 'Receipt Number' : 'Missing', companyName: payer, amount: amountPaid ?? labelledAmount(text, 'total|amount') ?? sokotoAmount, paymentPeriod, ...treasuryDate(text, encodedDate) };
    }
    return undefined;
};

export const getPaydirectPaymentReference = (text: string) =>
    text.match(/\bPayment[ \t]+Ref(?:erence)?\.?[ \t]*(?:Number|No\.?)[ \t]*[:;=]?[ \t]*(?:\n[ \t]*)?([A-Z0-9]+[ \t]*\|[ \t]*BRH[ \t]*\|[ \t]*[A-Z0-9-]+[ \t]*\|[ \t]*\d{1,2}-\d{1,2}-20\d{2}[ \t]*\|[ \t]*\d{4,9})\b/i)?.[1]?.replace(/[ \t]/g, '') ?? '';
