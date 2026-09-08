// This existing protected staging job supplies credentials and deployment evidence.
// No command-line credentials, historical pricing fixture, model or mail call.
import { runCurrentPaymentProof } from './staging-current-payment-proof.mjs';

try {
  if (process.argv.length !== 2) throw new Error('Unexpected CLI arguments');
  const result = await runCurrentPaymentProof();
  console.log(JSON.stringify(result));
  console.log(`STAGING_GATE: synthetic_cleanup=true run_id=${result.runId}`);
} catch {
  // Never echo response bodies, Auth data or credential-bearing error text.
  console.error('CURRENT_V4_STAGING_HELD: retain exact cleanup manifest; no automatic retry');
  process.exitCode = 1;
}
