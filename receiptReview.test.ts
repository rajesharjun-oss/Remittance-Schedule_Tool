import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assessReceiptReview,
    createReceiptDeduplicationKey,
    detectIdentifierType,
    normalizeTaxDetails
} from './receiptReview.ts';

test('normalizes detailed WHT descriptions while preserving remarks', () => {
    assert.deepEqual(
        normalizeTaxDetails('Withholding Tax on Professional Fees'),
        { taxType: 'WHT', remarks: 'WHT on Professional Fees' }
    );
});

test('keeps WVAT separate from VAT and WHT', () => {
    assert.deepEqual(
        normalizeTaxDetails('', 'Revenue Item: Withholding VAT'),
        { taxType: 'WVAT', remarks: 'WVAT' }
    );
});

test('uses NRS service descriptions instead of the generic VAT on charges column', () => {
    const cases = [
        ['CITWallet Credit', 'CIT'],
        ['Payment of SD', 'Stamp Duty'],
        ['VATWallet Credit', 'VAT'],
        ['WHTWallet Credit', 'WHT'],
        ['WVATWallet Credit', 'WVAT']
    ];

    for (const [serviceDescription, expectedTaxType] of cases) {
        assert.equal(
            normalizeTaxDetails('VAT', `VAT ON CHARGES (NGN)\n${serviceDescription}`).taxType,
            expectedTaxType
        );
    }
});

test('preserves the combined CIT and EDT label from an explicit source classification', () => {
    assert.deepEqual(
        normalizeTaxDetails('CIT & EDT', 'VAT ON CHARGES (NGN)\nCITWallet Credit'),
        { taxType: 'CIT & EDT', remarks: 'CIT & EDT' }
    );
});

test('identifies an RRR used as the alternative receipt identifier', () => {
    assert.equal(
        detectIdentifierType('Remita Retrieval Reference (RRR): 1014-3223-3272', '1014-3223-3272'),
        'RRR'
    );
});

test('does not label a payment reference as a receipt number when the receipt field is blank', () => {
    const text = 'Receipt Number:\nPayment Ref. Number: ABP|BRH|ABIA|17-04-2026|148695';
    assert.equal(
        detectIdentifierType(text, 'ABP|BRH|ABIA|17-04-2026|148695'),
        'Payment Reference'
    );
});

test('flags an inferred period but accepts an official RRR identifier', () => {
    const assessment = assessReceiptReview({
        paymentDate: '2026-02-18',
        paymentPeriod: 'Jan-26',
        paymentPeriodSource: 'payment-date',
        receiptNumber: '1014-3223-3272',
        identifierType: 'RRR',
        taxType: 'WHT',
        amount: 7355.32
    });

    assert.equal(assessment.confidence, 'high');
    assert.deepEqual(assessment.reviewIssues, ['Payment period was inferred from the payment date']);
});

test('does not request review for a complete receipt using an official RRR', () => {
    const assessment = assessReceiptReview({
        paymentDate: '2026-10-20',
        paymentPeriod: '2024',
        paymentPeriodSource: 'receipt',
        receiptNumber: '1615-2545-5541',
        identifierType: 'RRR',
        taxType: 'WHT',
        amount: 86986
    });

    assert.equal(assessment.confidence, 'high');
    assert.equal(assessment.confidenceScore, 100);
    assert.deepEqual(assessment.reviewIssues, []);
});

test('deduplicates formatting variations of the same identifier', () => {
    const first = createReceiptDeduplicationKey({
        identityKey: 'content:first',
        receiptNumber: '1014-3223-3272',
        paymentDate: '2026-02-18',
        amount: 7355.32,
        taxType: 'WHT'
    });
    const second = createReceiptDeduplicationKey({
        identityKey: 'content:second',
        receiptNumber: '1014 3223 3272',
        paymentDate: '2026-02-18',
        amount: 7355.32,
        taxType: 'WHT'
    });

    assert.equal(first, second);
});
