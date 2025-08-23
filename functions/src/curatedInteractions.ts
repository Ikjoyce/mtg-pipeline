import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Curated read endpoint for partner apps to fetch a small, safe slice of reddit_interactions.
// Callable from the client with firebase.functions().httpsCallable('curatedInteractions')
// Requires the authenticated user to have the custom claim `pipelineReader: true`.
export const curatedInteractions = functions.https.onCall(async (data: any, context: any) => {
  const limit = Math.min(500, Math.max(1, data && data.limit ? Number(data.limit) : 50));
  const subreddit = data && data.subreddit ? String(data.subreddit) : null;
  const daysBack = data && data.days_back ? Number(data.days_back) : null;

  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'request must be authenticated');
  const token = (context.auth.token || {}) as any;
  if (!token.pipelineReader) throw new functions.https.HttpsError('permission-denied', 'missing pipelineReader claim');

  try {
    let q: FirebaseFirestore.Query = admin.firestore().collection('reddit_interactions');
    if (subreddit) q = q.where('subreddit', '==', subreddit);
    if (daysBack && daysBack > 0) { const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000); q = q.where('timestamp', '>=', admin.firestore.Timestamp.fromDate(cutoff)); }
    q = q.orderBy('timestamp', 'desc').limit(limit);

    const snap = await q.get();
    const items = snap.docs.map(d => {
      const data = d.data() as any;
      return { id: d.id, question: data.question || null, answer: data.answer || null, confidence: (typeof data.confidence === 'number') ? data.confidence : null, upvotes: (typeof data.upvotes === 'number') ? data.upvotes : null, subreddit: data.subreddit || null, timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null, source_url: data.source_url || null };
    });

    return { items, count: items.length };
  } catch (e) {
    console.error('curatedInteractions error', e);
    throw new functions.https.HttpsError('internal', 'internal server error');
  }
});
