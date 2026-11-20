import { buildUpiPaymentUrl, isValidUpiId } from '../upi';

describe('upi', () => {
  it('validates UPI VPA format cleanly', () => {
    expect(isValidUpiId('shalom@okaxis')).toBe(true);
    expect(isValidUpiId('  bala.pg_1@ybl  ')).toBe(true);
    expect(isValidUpiId('9876543210@paytm')).toBe(true);

    expect(isValidUpiId('')).toBe(false);
    expect(isValidUpiId(null)).toBe(false);
    expect(isValidUpiId('not-a-upi')).toBe(false);
    expect(isValidUpiId('bad@123')).toBe(false);
    expect(isValidUpiId('bad name@sbi')).toBe(false);
  });

  it('builds a valid upi://pay deep link when inputs are valid and returns null otherwise', () => {
    const url = buildUpiPaymentUrl({
      upiId: 'owner@okicici',
      payeeName: 'Shalom Residency',
      amountPaise: 650000,
      note: 'Nov Rent',
    });

    expect(url).toBe(
      'upi://pay?pa=owner%40okicici&pn=Shalom%20Residency&am=6500.00&cu=INR&tn=Nov%20Rent'
    );

    expect(
      buildUpiPaymentUrl({
        upiId: 'invalid',
        payeeName: 'Shalom',
        amountPaise: 650000,
      })
    ).toBeNull();

    expect(
      buildUpiPaymentUrl({
        upiId: 'owner@okicici',
        payeeName: 'Shalom',
        amountPaise: 0,
      })
    ).toBeNull();
  });
});
