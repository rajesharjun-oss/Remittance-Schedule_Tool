import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { decodeDeltaReceiptPayload } from './receiptFormats.ts';
import { hasMissingRequiredReceiptFields } from './receiptReview.ts';

const server = await createServer({
    configFile: false,
    cacheDir: 'node_modules/.vite-receipt-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, ws: false, watch: null }
});
after(() => server.close());
const { parseReceiptText } = await server.ssrLoadModule('/App.tsx') as typeof import('./App.tsx');

const anambra = `ANAMBRA STATE IGR
PAYMENT RECEIPT
Customer Name: SAMPLE BANK LIMITED
Total Amount Paid: N 351,000.27
Payment Date: 28-Jul-26 10:40:42
Period Covered: Q3 2026
Receipt Number; 2600000123
Category Payment Amount
Personal Taxes (PAYE)
Deposit Slip Number: 1200222501`;

test('Anambra IGR captures the paid amount, official number and printed quarter', () => {
    const { rows } = parseReceiptText(anambra, 'sample.pdf');
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.deepEqual([row.state, row.paymentPeriod, row.amount, row.taxType, row.receiptNumber, row.paymentDate], [
        'Anambra', 'Q3 2026', 351000.27, 'PAYE', '2600000123', '2026-07-28'
    ]);
});

const enugu = `ENUGU STATE GOVERNMENT
INTERNAL REVENUE SERVICE
REVENUE RECEIPT
Taxpayer's Name: EXAMPLE MFB PAYE REM. JAN 2026 Receipt No: 2600000123Taxpayer
Payment Date: 02/16/2026 17:38:31
BANK|BRH|ESTAX|16-02-2026|100001
Revenue Name: Pay As You Earn (PAYE) - Companies
Other Details: January 2026 | West Branch
Amount Paid: N172,000.28
Printed on 27/02/2026, 13:31:00`;

test('Enugu keeps the official receipt number and month-first payment date', () => {
    const [row] = parseReceiptText(enugu, 'sample.pdf').rows;
    assert.deepEqual([row.state, row.receiptNumber, row.paymentDate, row.amount, row.paymentPeriod, row.taxType], [
        'Enugu', '2600000123', '2026-02-16', 172000.28, 'Jan-26', 'PAYE'
    ]);
    assert.deepEqual(row.reviewIssues, []);

    const [ambiguous] = parseReceiptText(enugu.replace('02/16/2026', '02/12/2026').replace('16-02-2026', '12-02-2026'), 'sample.pdf').rows;
    assert.equal(ambiguous.paymentDate, '2026-02-12');
    assert.deepEqual(ambiguous.reviewIssues, []);

    const [ocrCurrency] = parseReceiptText(enugu.replace('N172,000.28', '¥12,982,000.04'), 'sample.pdf').rows;
    assert.equal(ocrCurrency.amount, 12982000.04);
});

test('Enugu flags discordant dates and never substitutes the print date', () => {
    const [conflict] = parseReceiptText(enugu.replace('16-02-2026', '17-02-2026'), 'sample.pdf').rows;
    assert.equal(conflict.paymentDate, '2026-02-16');
    assert.match(conflict.reviewIssues.join(' '), /processor reference date disagree/);

    const [fallback] = parseReceiptText(enugu.replace('Payment Date: 02/16/2026 17:38:31', ''), 'sample.pdf').rows;
    assert.equal(fallback.paymentDate, '2026-02-16');

    const [missing] = parseReceiptText(enugu.replace(/Payment Date:.*\n|BANK\|BRH.*\n/g, ''), 'sample.pdf').rows;
    assert.equal(missing.paymentDate, '');
    assert.match(missing.reviewIssues.join(' '), /Payment date is missing/);
});

const bauchi = `BA HI STATE GOVE NMENT
PERSONAL INCOME TAX YEAR
RECEIPT
No. BASG 3 9 0 1 2 3
TREASURY
Revenue Division Centre
Date of Issue: 02/03/2026
Revenue Item Amount
BOARD OF INTERNAL REVENUEPAY AS YOU EARN (CURRENT) (BOARD OF INTERNAL REVENUE)
282,000.55`;

test('Bauchi reads the BASG serial and printed revenue item, with issue-date review', () => {
    const [row] = parseReceiptText(bauchi, 'Sample Bank FEB 2026.pdf').rows;
    assert.deepEqual([row.state, row.receiptNumber, row.paymentDate, row.amount, row.paymentPeriod, row.taxType], [
        'Bauchi', 'BASG390123', '2026-03-02', 282000.55, 'Feb-26', 'PAYE'
    ]);
    assert.match(row.reviewIssues.join(' '), /issue date only/);
});

test('Bauchi keeps unreadable fields in review and ignores handwritten total fragments', () => {
    const partial = bauchi.replace('BASG 3 9 0 1 2 3', 'B G 390123')
        .replace('02/03/2026', 'illegible').replace('282,000.55', '9) 000.55')
        .replace('TREASURY', 'Total 9\nTREASURY');
    const [row] = parseReceiptText(partial, 'Sample Bank FEB 2026.pdf').rows;
    assert.deepEqual([row.state, row.receiptNumber, row.paymentDate, row.amount], ['Bauchi', '', '', 0]);
    assert.equal(hasMissingRequiredReceiptFields(row), true);
});

test('Bauchi identifies the paper template when OCR only recovers the serial from a close-up', () => {
    const [row] = parseReceiptText(`No. BASG 390123
GOVERNMENT
PERSONAL INCOME TAX YEAR
Agency Revenue Item Amount
BOARD OF INTERNAL REVENUEPAY AS YOU EARN (CURRENT) (BOARD OF INTERNAL REVENUE)
Amount Paid: NGN 282000.55`, 'Sample Bank FEB 2026.pdf').rows;
    assert.deepEqual([row.state, row.receiptNumber, row.amount, row.taxType], ['Bauchi', 'BASG390123', 282000.55, 'PAYE']);
});

test('recognizes the paid Plateau layout and preserves a labelled billing reference', () => {
    const [row] = parseReceiptText(`PLATEAU STATE INTERNAL REVENUE SERVICE
Revenue receipt
Payer Name: SAMPLE BANK LIMITED
Description: PAYE REM. MAY. 2026
Period 2026-05-01 - 2026-05-31
Billing Ref: 9012345600
Amount NGN 72,320.67
Date Paid 4th June 2026
Status PAID`, 'sample.pdf').rows;
    assert.deepEqual([row.state, row.paymentPeriod, row.amount, row.receiptNumber, row.identifierType, row.paymentDate], [
        'Plateau', 'May-26', 72320.67, '9012345600', 'Billing Reference', '2026-06-04'
    ]);
});

test('recovers the paid amount and period when a Plateau scan lists table values separately', () => {
    const [row] = parseReceiptText('PLATEAU STATE GOVERNMENT\nREVENUE RECEIPT\nStatus\nAmount\nPeriod\nBilling Ref: 9012345600\nDate Paid: 4th June 2026\nPAID\nTax Item PAYE\nNGN 72, 320.67\n2026-05-01 - 2026-05-31', 'sample.pdf').rows;
    assert.deepEqual([row.state, row.paymentPeriod, row.amount], ['Plateau', 'May-26', 72320.67]);
});

test('uses the Yobe revenue receipt number and transaction date without taking the print date', () => {
    const [row] = parseReceiptText(`Printed on: 31/03/2026
Receipt No: 2026 / 03 / YB / 4001
REVENUE RECEIPT
Payer Name SAMPLE BANK LIMITED
Transaction Date 04/03/2026
Revenue Code 101000-PAYE Private Org Sector
Description PAYE REM. FEBRUARY 2026
Amount Paid 400,001.00`, 'sample.pdf').rows;
    assert.deepEqual([row.state, row.paymentPeriod, row.amount, row.receiptNumber, row.paymentDate], [
        'Yobe', 'Feb-26', 400001, '2026/03/YB/4001', '2026-03-04'
    ]);
});

test('uses the official Ondo receipt number ahead of the transaction ID and Payer ID', () => {
    const [row] = parseReceiptText(`e-REVENUE RECEIPT
ONDO STATE GOVERNMENT
Transaction ID: 123456 (Payment Details) NGN 332,586.57
Received From: SAMPLE BANK LTD
Payer's ID: B-890000
Payment Date: 2026-08-12
Receipt No: A000000003343
Being: PAYE JULY 2026`, 'sample.pdf').rows;
    assert.deepEqual([row.state, row.amount, row.receiptNumber, row.paymentDate, row.taxType], [
        'Ondo', 332586.57, 'A000000003343', '2026-08-12', 'PAYE'
    ]);
});

test('keeps Oyo tax conflicts unresolved and prefers the payment reference date over the print date', () => {
    const [row] = parseReceiptText(`BANK|BRH|OYMC|12-11-2026|789123
OYO STATE GOVERNMENT
REVENUE RECEIPT
No: 2633000015
Date: 13/11/2026
Paid By: SAMPLE BANK LIMITED
Amount: NGN 533,320.19
Being: WHT on Treasury Bills OCT 2026
Revenue Item: PAYE Recoverables`, 'Sample PAYE October 2026.pdf').rows;
    assert.equal(row.receiptNumber, '2633000015');
    assert.equal(row.paymentDate, '2026-11-12');
    assert.equal(row.taxType, '');
    assert.match(row.reviewIssues.join(' '), /revenue item and narration disagree/);
    assert.equal(hasMissingRequiredReceiptFields(row), true);
});

test('keeps distinct revenue receipts in the same page', () => {
    const first = 'OYO STATE GOVERNMENT\nREVENUE RECEIPT\nNo: 2633000015\nDate: 13/11/2026\nAmount: NGN 533,320.19\nBeing: PAYE OCT 2026';
    const second = first.replace('2633000015', '2633000016').replace('533,320.19', '100,000.00');
    const { rows } = parseReceiptText(first + '\n' + second, 'sample.pdf');
    assert.deepEqual(rows.map(row => row.receiptNumber), ['2633000015', '2633000016']);
});

test('flags the Kwara PayDirect revenue table when it conflicts with the payer narration', () => {
    const [row] = parseReceiptText(`KWIRS (KWARA IRS)
PAYMENT RECEIPT
Customer Name: WHT TBS FOR REMIT MAR 2026
Total Amount Paid: N 533,320.19
Payment Date: 10-Apr-26 15:00:30
Receipt Number: 2633000015
Agency Payment Amount
KWARA STATE INTERNAL REVENUE SERVICE (KWIRS)PAYE Recoverables - KWIRS 533,320.19`, 'WHT TBs MAR 2026.pdf').rows;
    assert.equal(row.state, 'Kwara');
    assert.equal(row.taxType, '');
    assert.match(row.reviewIssues.join(' '), /revenue item and narration disagree/);
});

test('keeps treasury issue dates visible for review and uses state-specific serials', () => {
    for (const [state, ref, expected] of [
        ['Adamawa', 'AD / 200019', 'AD/200019'],
        ['Kebbi', 'PIT2605051234', 'PIT2605051234'],
        ['Sokoto', 'RCP-20260506-QA29BC', 'RCP-20260506-QA29BC'],
        ['Taraba', 'TR/105678', 'TR/105678'],
        ['Jigawa', 'JG/109012', 'JG/109012']
    ]) {
        const [row] = parseReceiptText(`${state} State Government
PERSONAL INCOME TAX
TREASURY RECEIPT
No. ${ref}
Total NGN 12,321.50
Date of Issue 13 May 2026
Being: PAYE APRIL 2026`, 'sample.pdf').rows;
        assert.deepEqual([row.state, row.receiptNumber, row.amount, row.paymentDate], [state, expected, 12321.50, '2026-05-13']);
        assert.match(row.reviewIssues.join(' '), /issue date only/);
    }
});

test('a bank slip, labelled unpaid receipt and remittance invoice do not create schedule rows', () => {
    const bankSlip = 'CASH DEPOSIT SLIP\nBank Teller: 712345\nDeposit Slip Number: 78012345\nTotal Cash: N 351,000.27\nDate: 28 July 2026';
    const invoice = 'Remita Invoice\nRemita Retrieval Reference (RRR)\n7218-8022-3999\nAmount: NGN 351,000.27\nStatus: Pending';
    assert.deepEqual(parseReceiptText(bankSlip + '\n\f\n' + invoice, 'Sample PAYE July 2026.pdf').rows, []);
    assert.equal(parseReceiptText(anambra + '\n\f\n' + bankSlip, 'sample.pdf').rows.length, 1);
});

test('Delta QR keeps the leading zero and resolves only unambiguous encoded dates', () => {
    const code = 'Assessment Ref:N/A Payment Ref:DTS/BANK/XPS/2673/100001/100008 Receipt Number:0326622607031724558100000 Customer Name:SAMPLE BANK PAYE REM. JUN 2026 Payment Amount:612000.94TransactionReference:80000001';
    const decoded = decodeDeltaReceiptPayload(code);
    const [row] = parseReceiptText('DELTA STATE\n' + decoded, 'sample.pdf').rows;
    assert.deepEqual([row.state, row.receiptNumber, row.paymentDate, row.paymentPeriod, row.amount, row.taxType], [
        'Delta', '0326622607031724558100000', '2026-07-03', 'Jun-26', 612000.94, 'PAYE'
    ]);
    assert.doesNotMatch(decodeDeltaReceiptPayload(code.replace('/2673/', '/26112/')), /Delta QR date/);
    assert.equal(decodeDeltaReceiptPayload('https://example.com/receipt?paid=true'), '');
    const [conflict] = parseReceiptText('DELTA STATE\nREVENUE RECEIPT\nAmount Paid: NGN 1,100.00\n' + decoded, 'sample.pdf').rows;
    assert.match(conflict.reviewIssues.join(' '), /QR and printed fields disagree/);
});

test('PayDirect falls back to the complete payment reference when the printed field is empty', () => {
    const [row] = parseReceiptText(`EDO STATE PAYDIRECT NEW
PAYMENT RECEIPT
Customer Name: SAMPLE BANK LTD
Payment Date: 20-May-26
Total Amount Paid: N 35,000.00
Payment Ref. Number: BANK | BRH | EDSG | 20-05-2026 | 777900
Receipt Number:
Serial Number: 003142579099
Tax Type: PAYE`, 'Sample PAYE April 2026.pdf').rows;
    assert.equal(row.receiptNumber, 'BANK|BRH|EDSG|20-05-2026|777900');
    assert.equal(row.identifierType, 'Payment Reference');
});
