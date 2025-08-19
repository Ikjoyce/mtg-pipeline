"use strict";
// Reddit MTG Training Data Collection System (TypeScript version)
// This is a scaffold for porting the Python logic to TypeScript/Node.js for use in Firebase Functions.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectRedditMTGData = void 0;
const dotenv = __importStar(require("dotenv"));
dotenv.config({ path: '../../.env' });
const functions = __importStar(require("firebase-functions"));
const snoowrap_1 = __importDefault(require("snoowrap"));
// Known MTG judges on Reddit (add as needed)
const knownJudges = new Set([
    'ubernostrum', 'Judge_Todd', 'liucoke', 'tbshawk'
]);
// Subreddits to target
const targetSubreddits = [
    'magicTCG',
    'MTGRules',
    'CompetitiveMTG',
    'EDH',
    'ModernMagic',
    'spikes'
];
// Placeholder for main function
exports.collectRedditMTGData = functions.https.onRequest(async (req, res) => {
    // NOTE: In production, use environment variables or Firebase secrets for credentials
    const reddit = new snoowrap_1.default({
        userAgent: 'MTG_Training_Data_Collector_v1.0',
        clientId: process.env.REDDIT_CLIENT_ID || 'R6QA5a5zw_aBmrCdnKKZsg',
        clientSecret: process.env.REDDIT_CLIENT_SECRET || 'Vn_QjIpCLFkO5W8dCp8wtUuU3_5eqw',
        refreshToken: process.env.REDDIT_REFRESH_TOKEN || 'YOUR_REFRESH_TOKEN',
    });
    const interactions = [];
    // Work around snoowrap typing issue by using a typed-any client for runtime calls
    const redditAny = reddit;
    for (const subredditName of targetSubreddits) {
        const subreddit = await redditAny.getSubreddit(subredditName);
        const posts = await subreddit.getHot({ limit: 10 }); // Limit for demo
        for (const submission of posts) {
            if (!isRulesQuestion(submission.title + ' ' + (submission.selftext || '')))
                continue;
            const bestAnswer = await getBestAnswer(submission);
            if (!bestAnswer)
                continue;
            const interaction = {
                question: submission.title + '\n\n' + (submission.selftext || ''),
                topAnswer: bestAnswer.body,
                confidenceScore: calculateConfidence(submission, bestAnswer),
                upvotes: bestAnswer.score,
                answeredByJudge: knownJudges.has(bestAnswer.author),
                ruleReferences: extractRuleReferences(bestAnswer.body),
                cardsMentioned: extractCardNames(submission.title + ' ' + (submission.selftext || '')),
                interactionType: classifyInteraction(submission.title + ' ' + (submission.selftext || '')),
                sourceUrl: `https://reddit.com${submission.permalink}`,
                timestamp: new Date(submission.created_utc * 1000).toISOString(),
            };
            interactions.push(interaction);
        }
    }
    res.status(200).json({ count: interactions.length, interactions });
});
function isRulesQuestion(text) {
    const rulesIndicators = [
        'interaction', 'stack', 'resolve', 'priority', 'trigger',
        'can i', 'does this work', 'rules question', 'timing',
        'when does', 'how does', 'what happens', 'counter',
        'target', 'legal', 'allowed', 'etb', 'enters the battlefield'
    ];
    const textLower = text.toLowerCase();
    return rulesIndicators.some(ind => textLower.includes(ind));
}
async function getBestAnswer(submission) {
    await submission.expandReplies({ limit: 10, depth: 1 });
    let bestComment = null;
    let bestScore = 0;
    for (const comment of submission.comments) {
        if (!comment || !comment.body || comment.score < 5)
            continue;
        const judgeBonus = knownJudges.has(comment.author?.name) ? 50 : 0;
        const ruleBonus = hasRuleReferences(comment.body) ? 20 : 0;
        const lengthBonus = Math.min(comment.body.length / 50, 30);
        const totalScore = comment.score + judgeBonus + ruleBonus + lengthBonus;
        if (totalScore > bestScore && comment.body.length > 100) {
            bestScore = totalScore;
            bestComment = {
                body: comment.body,
                score: comment.score,
                author: comment.author?.name || 'deleted',
            };
        }
    }
    return bestComment;
}
function hasRuleReferences(text) {
    return /\b\d{3}\.\d+[a-z]?\b/.test(text);
}
function extractRuleReferences(text) {
    const matches = text.match(/\b(\d{3}\.\d+[a-z]?)\b/g);
    return matches ? Array.from(new Set(matches)) : [];
}
function extractCardNames(text) {
    // Simple pattern for [[Card Name]] and Title Case
    const patterns = [
        /\[\[([^\]]+)\]\]/g,
        /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
    ];
    let cards = [];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            if (isLikelyCardName(match[1] || match[0]))
                cards.push(match[1] || match[0]);
        }
    }
    return Array.from(new Set(cards));
}
function isLikelyCardName(text) {
    if (text.length < 3 || text.length > 50)
        return false;
    if (/\d/.test(text))
        return false;
    const falsePositives = [
        'Magic The Gathering', 'Rules Question', 'Stack Overflow',
        'Modern Format', 'Standard Format', 'Commander Format'
    ];
    return !falsePositives.includes(text);
}
function classifyInteraction(text) {
    const textLower = text.toLowerCase();
    if (/(counter|counterspell)/.test(textLower))
        return 'counterspell';
    if (/(stack|resolve|response)/.test(textLower))
        return 'stack_interaction';
    if (/(target|targeting|hexproof)/.test(textLower))
        return 'targeting';
    if (/(trigger|etb|enters|when|whenever)/.test(textLower))
        return 'triggered_ability';
    if (/(activate|tap|ability)/.test(textLower))
        return 'activated_ability';
    if (/(combat|attack|block)/.test(textLower))
        return 'combat';
    if (/(timing|priority|phase)/.test(textLower))
        return 'timing';
    return 'general';
}
function calculateConfidence(submission, bestAnswer) {
    let base = 0.5;
    if (submission.upvote_ratio > 0.8)
        base += 0.1;
    if (knownJudges.has(bestAnswer.author))
        base += 0.3;
    if (bestAnswer.score > 20)
        base += 0.2;
    else if (bestAnswer.score > 10)
        base += 0.1;
    if (hasRuleReferences(bestAnswer.body))
        base += 0.15;
    if (bestAnswer.body.length > 500)
        base += 0.1;
    return Math.min(base, 0.95);
}
