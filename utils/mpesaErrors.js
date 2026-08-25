// utils/mpesaErrors.js
//
// Maps Safaricom M-Pesa STK ResultCode (passed through by PayHero's webhook
// as-is) to a machine-readable `type` and a clear buyer-facing message.
// Single source of truth — never show raw ResultDesc to the buyer.

const MPESA_RESULT_CODES = {
  0:    { type: 'success',            message: 'Payment completed successfully.' },
  1:    { type: 'insufficient_funds', message: 'Insufficient M-Pesa balance. Please top up and try again.' },
  1032: { type: 'cancelled',          message: 'You cancelled the M-Pesa prompt before completing payment.' },
  1037: { type: 'timeout',            message: 'You did not respond to the M-Pesa prompt in time.' },
  2001: { type: 'wrong_pin',          message: 'Wrong M-Pesa PIN entered. Please try again with the correct PIN.' },
  1001: { type: 'in_progress',        message: 'You already have an M-Pesa request in progress. Finish or cancel it, then try again.' },
  9999: { type: 'system_error',       message: 'M-Pesa could not process this request right now. Please try again shortly.' },
};

function interpretMpesaResult(resultCode, resultDesc) {
  const code = Number(resultCode);
  const known = MPESA_RESULT_CODES[code];
  if (known) return { code, ...known };
  return {
    code: Number.isFinite(code) ? code : null,
    type: 'failed',
    message: resultDesc && String(resultDesc).trim()
      ? `Payment failed: ${resultDesc}`
      : 'Payment could not be completed. Please try again.',
  };
}

module.exports = { interpretMpesaResult, MPESA_RESULT_CODES };