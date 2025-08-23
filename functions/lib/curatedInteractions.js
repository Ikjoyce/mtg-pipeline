"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.curatedInteractions = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// Curated read endpoint for partner apps to fetch a small, safe slice of reddit_interactions.
// Callable from the client with firebase.functions().httpsCallable('curatedInteractions')
// Requires the authenticated user to have the custom claim `pipelineReader: true`.
exports.curatedInteractions = functions.https.onCall(async (data, context) => {
    const limit = Math.min(500, Math.max(1, data && data.limit ? Number(data.limit) : 50));
    const subreddit = data && data.subreddit ? String(data.subreddit) : null;
    const daysBack = data && data.days_back ? Number(data.days_back) : null;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'request must be authenticated');
    const token = (context.auth.token || {});
    if (!token.pipelineReader)
        throw new functions.https.HttpsError('permission-denied', 'missing pipelineReader claim');
    try {
        let q = admin.firestore().collection('reddit_interactions');
        if (subreddit)
            q = q.where('subreddit', '==', subreddit);
        if (daysBack && daysBack > 0) {
            const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
            q = q.where('timestamp', '>=', admin.firestore.Timestamp.fromDate(cutoff));
        }
        q = q.orderBy('timestamp', 'desc').limit(limit);
        const snap = await q.get();
        const items = snap.docs.map(d => {
            const data = d.data();
            return { id: d.id, question: data.question || null, answer: data.answer || null, confidence: (typeof data.confidence === 'number') ? data.confidence : null, upvotes: (typeof data.upvotes === 'number') ? data.upvotes : null, subreddit: data.subreddit || null, timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null, source_url: data.source_url || null };
        });
        return { items, count: items.length };
    }
    catch (e) {
        console.error('curatedInteractions error', e);
        throw new functions.https.HttpsError('internal', 'internal server error');
    }
});
