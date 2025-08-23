import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Callable admin helper to set the pipelineReader custom claim on a user.
// Security: this callable should be restricted (only callable by project owners or via a secure CI).
export const setPipelineReaderClaim = functions.https.onCall(async (data: any, context: any) => {
  // Only allow invocation by authenticated admin users (customize as needed)
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'must be authenticated');
  const token = (context.auth.token || {}) as any;
  if (!token.admin) {
    // Require that caller has an 'admin' custom claim; adjust to your org's policy.
    throw new functions.https.HttpsError('permission-denied', 'caller must be admin');
  }

  const uid = data && data.uid ? String(data.uid) : null;
  const enable = data && typeof data.enable === 'boolean' ? data.enable : true;
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid is required');

  try {
    const claims = enable ? { pipelineReader: true } : { pipelineReader: null };
    await admin.auth().setCustomUserClaims(uid, claims);
    return { success: true, uid, pipelineReader: enable };
  } catch (e) {
    console.error('setPipelineReaderClaim error', e);
    throw new functions.https.HttpsError('internal', 'failed to set custom claim');
  }
});
