// This existing protected staging job supplies credentials and deployment evidence.
// No command-line credentials, historical pricing fixture, model or mail call.
import { runCurrentPaymentProof,checkoutPreflightDiagnostic,retainCheckoutPreflightDiagnostic } from './staging-current-payment-proof.mjs';

try {
  if (process.argv.length !== 2) throw new Error('Unexpected CLI arguments');
  const result = await runCurrentPaymentProof();
  console.log(JSON.stringify(result));
  console.log(`STAGING_GATE: synthetic_cleanup=true run_id=${result.runId}`);
} catch(error) {
  // Never echo response bodies, Auth data or credential-bearing error text.
  const diagnostic=checkoutPreflightDiagnostic(error);
  if(diagnostic){
    let artifactRetained=false;
    try{artifactRetained=await retainCheckoutPreflightDiagnostic(error);}catch{}
    console.error(JSON.stringify({...diagnostic,artifactRetained}));
  }
  console.error('CURRENT_V4_STAGING_HELD: retain exact cleanup manifest; no automatic retry');
  process.exitCode = 1;
}
