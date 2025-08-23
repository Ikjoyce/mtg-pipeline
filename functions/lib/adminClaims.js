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
exports.setPipelineReaderClaim = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// Callable admin helper to set the pipelineReader custom claim on a user.
// Security: this callable should be restricted (only callable by project owners or via a secure CI).
exports.setPipelineReaderClaim = functions.https.onCall(async (data, context) => {
    // Only allow invocation by authenticated admin users (customize as needed)
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'must be authenticated');
    const token = (context.auth.token || {});
    if (!token.admin) {
        // Require that caller has an 'admin' custom claim; adjust to your org's policy.
        throw new functions.https.HttpsError('permission-denied', 'caller must be admin');
    }
    const uid = data && data.uid ? String(data.uid) : null;
    const enable = data && typeof data.enable === 'boolean' ? data.enable : true;
    if (!uid)
        throw new functions.https.HttpsError('invalid-argument', 'uid is required');
    try {
        const claims = enable ? { pipelineReader: true } : { pipelineReader: null };
        await admin.auth().setCustomUserClaims(uid, claims);
        return { success: true, uid, pipelineReader: enable };
    }
    catch (e) {
        console.error('setPipelineReaderClaim error', e);
        throw new functions.https.HttpsError('internal', 'failed to set custom claim');
    }
});
