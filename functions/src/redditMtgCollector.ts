
// Reddit MTG Training Data Collection System (TypeScript version)
// This is a scaffold for porting the Python logic to TypeScript/Node.js for use in Firebase Functions.

import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });


import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Request, Response } from 'express';
import Snoowrap from 'snoowrap';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Data structure for an MTG interaction
export interface MTGInteraction {
  question: string;
  topAnswer: string;
  confidenceScore: number;
  upvotes: number;
  answeredByJudge: boolean;
  ruleReferences: string[];
  cardsMentioned: string[];
  interactionType: string;
  sourceUrl: string;
  timestamp: string;
}

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
admin.initializeApp();

function getRedditConfig() {
  const cfg = (functions.config && functions.config().reddit) ? functions.config().reddit : {} as any;
  return {
    userAgent: cfg.user_agent || process.env.REDDIT_USER_AGENT || 'MTG_Training_Data_Collector_v1.0',
    clientId: cfg.client_id || process.env.REDDIT_CLIENT_ID,
    clientSecret: cfg.client_secret || process.env.REDDIT_CLIENT_SECRET,
    refreshToken: cfg.refresh_token || process.env.REDDIT_REFRESH_TOKEN,
  };
}

// Secret Manager helper - tries to read secrets from Secret Manager and return values if available.
const smClient = new SecretManagerServiceClient();

async function readSecretValue(secretId: string): Promise<string|undefined> {
  try {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || 'stacksagemtg';
    const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;
    const [accessResponse] = await smClient.accessSecretVersion({ name });
    const payload = accessResponse.payload?.data?.toString();
    return payload;
  } catch (err) {
    // secret not found or permissions issue - return undefined to allow fallback
    return undefined;
  }
}

async function getRedditConfigFromSecrets(): Promise<Record<string,string|undefined>> {
  const keys = ['REDDIT_CLIENT_ID','REDDIT_CLIENT_SECRET','REDDIT_REFRESH_TOKEN','REDDIT_USER_AGENT'];
  const out: Record<string,string|undefined> = {};
  for (const k of keys) {
    const v = await readSecretValue(k);
    out[k] = v;
  }
  return out;
}

// Core collector logic separated so it can be reused by HTTP handler or other triggers
async function runCollector(redditCfg: { userAgent: string, clientId: string, clientSecret: string, refreshToken: string }): Promise<MTGInteraction[]> {
  const reddit = new Snoowrap({
    userAgent: redditCfg.userAgent,
    clientId: redditCfg.clientId,
    clientSecret: redditCfg.clientSecret,
    refreshToken: redditCfg.refreshToken,
  });

  const interactions: MTGInteraction[] = [];
  const redditAny: any = reddit as any;

  for (const subredditName of targetSubreddits) {
    const subreddit: any = await redditAny.getSubreddit(subredditName);
    const posts: any = await subreddit.getHot({ limit: 10 }); // Limit for demo
    for (const submission of posts) {
      if (!isRulesQuestion(submission.title + ' ' + (submission.selftext || ''))) continue;
      const bestAnswer = await getBestAnswer(submission);
      if (!bestAnswer) continue;
      const interaction: MTGInteraction = {
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
  return interactions;
}

export const collectRedditMTGData = functions.https.onRequest(async (req: Request, res: Response) => {
  // Prefer Secret Manager values, then functions.config(), then .env
  const secretVals = await getRedditConfigFromSecrets();
  const cfgFallback = getRedditConfig();
  const redditCfg = {
    userAgent: secretVals.REDDIT_USER_AGENT || cfgFallback.userAgent,
    clientId: secretVals.REDDIT_CLIENT_ID || cfgFallback.clientId,
    clientSecret: secretVals.REDDIT_CLIENT_SECRET || cfgFallback.clientSecret,
    refreshToken: secretVals.REDDIT_REFRESH_TOKEN || cfgFallback.refreshToken,
  };

  if (!redditCfg.clientId || !redditCfg.clientSecret || !redditCfg.refreshToken) {
    res.status(500).send('Reddit credentials not configured');
    return;
  }

  try {
    const interactions = await runCollector(redditCfg);
    res.status(200).json({ count: interactions.length, interactions });
  } catch (err: any) {
    res.status(500).send(`Collector error: ${err?.message || err}`);
  }
});

// Scheduled function that runs every night at 02:00 UTC (cron)
// Note: scheduled (pubsub) functions require firebase-functions v2 PubSub API typings. We can add a scheduled trigger
// later after aligning SDK versions. For now we provide an HTTP manual trigger (`collectRedditMTGData`).

function isRulesQuestion(text: string): boolean {
  const rulesIndicators = [
    'interaction', 'stack', 'resolve', 'priority', 'trigger',
    'can i', 'does this work', 'rules question', 'timing',
    'when does', 'how does', 'what happens', 'counter',
    'target', 'legal', 'allowed', 'etb', 'enters the battlefield'
  ];
  const textLower = text.toLowerCase();
  return rulesIndicators.some(ind => textLower.includes(ind));
}

async function getBestAnswer(submission: any): Promise<any | null> {
  await submission.expandReplies({ limit: 10, depth: 1 });
  let bestComment = null;
  let bestScore = 0;
  for (const comment of submission.comments) {
    if (!comment || !comment.body || comment.score < 5) continue;
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

function hasRuleReferences(text: string): boolean {
  return /\b\d{3}\.\d+[a-z]?\b/.test(text);
}

function extractRuleReferences(text: string): string[] {
  const matches = text.match(/\b(\d{3}\.\d+[a-z]?)\b/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function extractCardNames(text: string): string[] {
  // Simple pattern for [[Card Name]] and Title Case
  const patterns = [
    /\[\[([^\]]+)\]\]/g,
    /\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
  ];
  let cards: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (isLikelyCardName(match[1] || match[0])) cards.push(match[1] || match[0]);
    }
  }
  return Array.from(new Set(cards));
}

function isLikelyCardName(text: string): boolean {
  if (text.length < 3 || text.length > 50) return false;
  if (/\d/.test(text)) return false;
  const falsePositives = [
    'Magic The Gathering', 'Rules Question', 'Stack Overflow',
    'Modern Format', 'Standard Format', 'Commander Format'
  ];
  return !falsePositives.includes(text);
}

function classifyInteraction(text: string): string {
  const textLower = text.toLowerCase();
  if (/(counter|counterspell)/.test(textLower)) return 'counterspell';
  if (/(stack|resolve|response)/.test(textLower)) return 'stack_interaction';
  if (/(target|targeting|hexproof)/.test(textLower)) return 'targeting';
  if (/(trigger|etb|enters|when|whenever)/.test(textLower)) return 'triggered_ability';
  if (/(activate|tap|ability)/.test(textLower)) return 'activated_ability';
  if (/(combat|attack|block)/.test(textLower)) return 'combat';
  if (/(timing|priority|phase)/.test(textLower)) return 'timing';
  return 'general';
}

function calculateConfidence(submission: any, bestAnswer: any): number {
  let base = 0.5;
  if (submission.upvote_ratio > 0.8) base += 0.1;
  if (knownJudges.has(bestAnswer.author)) base += 0.3;
  if (bestAnswer.score > 20) base += 0.2;
  else if (bestAnswer.score > 10) base += 0.1;
  if (hasRuleReferences(bestAnswer.body)) base += 0.15;
  if (bestAnswer.body.length > 500) base += 0.1;
  return Math.min(base, 0.95);
}
