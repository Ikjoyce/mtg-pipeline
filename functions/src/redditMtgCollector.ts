
// Reddit MTG Training Data Collection System (TypeScript version)
// This is a scaffold for porting the Python logic to TypeScript/Node.js for use in Firebase Functions.

import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });


import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { Request, Response } from 'express';
import Snoowrap from 'snoowrap';
import { createHash } from 'crypto';
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
  subreddit?: string;
}

type CollectorOptions = {
  postLimit?: number;
  sources?: string[];
  streams?: Array<'hot'|'new'|'top'>;
  minCommentScore?: number;
  minAnswerLength?: number;
  dryRun?: boolean;
  strictMagicFlair?: boolean;
};

// Known MTG judges on Reddit (add as needed)
const knownJudges = new Set([
  'ubernostrum', 'Judge_Todd', 'liucoke', 'tbshawk'
]);

// Subreddits to target
const targetSubreddits = [
  // Focus on rule questions first; can be overridden via query param 'sources'
  'MTGRules',
  'magicTCG',
];

// Placeholder for main function
admin.initializeApp();

function getRedditConfig() {
  // Prefer environment variables (including Functions v2 secrets) and avoid hard dependency on functions.config()
  const out: any = {
    userAgent: process.env.REDDIT_USER_AGENT || 'MTG_Training_Data_Collector_v1.0',
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    refreshToken: process.env.REDDIT_REFRESH_TOKEN,
  };

  // Best-effort: attempt to read functions.config() if available (v1), but ignore errors in v2
  try {
    const anyFuncs: any = functions as any;
    if (anyFuncs && typeof anyFuncs.config === 'function') {
      const cfgRoot = anyFuncs.config();
      const cfg = (cfgRoot && cfgRoot.reddit) ? cfgRoot.reddit : {};
      out.userAgent = out.userAgent || cfg.user_agent;
      out.clientId = out.clientId || cfg.client_id;
      out.clientSecret = out.clientSecret || cfg.client_secret;
      out.refreshToken = out.refreshToken || cfg.refresh_token;
    }
  } catch (_) {
    // functions.config() is not supported in v2; ignore
  }

  return out;
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
async function runCollector(
  redditCfg: { userAgent: string, clientId: string, clientSecret: string, refreshToken: string },
  opts: CollectorOptions = {}
): Promise<{ interactions: MTGInteraction[]; metrics: Record<string, number> }> {
  const reddit = new Snoowrap({
    userAgent: redditCfg.userAgent,
    clientId: redditCfg.clientId,
    clientSecret: redditCfg.clientSecret,
    refreshToken: redditCfg.refreshToken,
  });

  const interactions: MTGInteraction[] = [];
  const redditAny: any = reddit as any;
  const metrics = {
    subreddits: 0,
    posts_scanned: 0,
    rules_like: 0,
    with_candidate_answer: 0,
    persisted: 0,
    skipped_duplicate: 0,
    flair_rules: 0,
    excluded_decklike: 0,
    comments_scored: 0,
    comments_skipped_low_quality: 0,
  } as Record<string, number>;

  const postLimit = Math.min(Math.max(opts.postLimit ?? 25, 5), 100);
  const streams = (opts.streams && opts.streams.length ? opts.streams : ['hot','new']) as Array<'hot'|'new'|'top'>;
  const subreddits = (opts.sources && opts.sources.length ? opts.sources : targetSubreddits);
  const minCommentScore = opts.minCommentScore ?? 1;
  const minAnswerLength = opts.minAnswerLength ?? 80;

  for (const subredditName of subreddits) {
    const subreddit: any = await redditAny.getSubreddit(subredditName);
    metrics.subreddits++;
    // fetch from multiple streams and de-duplicate by id
    const fetched: any[] = [];
    for (const stream of streams) {
      try {
        const list = stream === 'new'
          ? await subreddit.getNew({ limit: postLimit })
          : stream === 'top'
            ? await subreddit.getTop({ time: 'day', limit: postLimit })
            : await subreddit.getHot({ limit: postLimit });
        fetched.push(...list);
      } catch (e) {
        console.warn(`Fetch failed for ${subredditName} ${stream}:`, e);
      }
    }
    const seen = new Set<string>();
    const posts = fetched.filter(p => {
      if (!p || !p.id) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    for (const submission of posts) {
      metrics.posts_scanned++;
      if (!isRulesPost(submission, metrics, { strictMagicFlair: !!opts.strictMagicFlair })) continue;
      metrics.rules_like++;
  const bestAnswer = await getBestAnswer(submission, metrics);
      if (!bestAnswer) continue;
      if (bestAnswer.score < minCommentScore) continue;
      if (!bestAnswer.body || bestAnswer.body.length < minAnswerLength) continue;
      metrics.with_candidate_answer++;
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
        subreddit: subredditName,
      };
      interactions.push(interaction);
    }
  }
  // Persist interactions to Firestore in batches
  try {
    const db = admin.firestore();
    const BATCH_SIZE = 400; // keep under 500
    for (let i = 0; i < interactions.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = interactions.slice(i, i + BATCH_SIZE);
      for (const interaction of chunk) {
        const ts = new Date(interaction.timestamp);
        // Deterministic ID: prefer sourceUrl, fallback to question hash
        const idSource = interaction.sourceUrl || interaction.question;
        const id = createHash('sha256').update(idSource).digest('hex');
        const docRef = db.collection('reddit_interactions').doc(id);

        // Only create if not exists to deduplicate
        const snap = await docRef.get();
        if (snap.exists) { metrics.skipped_duplicate++; continue; }

        // Add collected_at and source tags
        const data = {
          question: interaction.question,
          answer: interaction.topAnswer,
          confidence: interaction.confidenceScore,
          upvotes: interaction.upvotes,
          answered_by_judge: interaction.answeredByJudge,
          rule_references: interaction.ruleReferences,
          cards_mentioned: interaction.cardsMentioned,
          interaction_type: interaction.interactionType,
          source_url: interaction.sourceUrl,
          subreddit: interaction.subreddit || null,
          source_tags: ['reddit', 'collected_by_pipeline'],
          collected_at: admin.firestore.Timestamp.fromDate(new Date()),
          timestamp: admin.firestore.Timestamp.fromDate(ts)
        } as any;
        if (!opts.dryRun) batch.set(docRef, data);
        metrics.persisted++;
      }
      if (!opts.dryRun) await batch.commit();
    }
  } catch (err) {
    console.error('Error writing interactions to Firestore:', err);
  }

  return { interactions, metrics };
}

// Declare secrets so Functions v2 mounts them as environment variables at runtime
const S_REDDIT_CLIENT_ID = defineSecret('REDDIT_CLIENT_ID');
const S_REDDIT_CLIENT_SECRET = defineSecret('REDDIT_CLIENT_SECRET');
const S_REDDIT_REFRESH_TOKEN = defineSecret('REDDIT_REFRESH_TOKEN');
const S_REDDIT_USER_AGENT = defineSecret('REDDIT_USER_AGENT');

export const collectRedditMTGData = onRequest({ secrets: [
  S_REDDIT_CLIENT_ID,
  S_REDDIT_CLIENT_SECRET,
  S_REDDIT_REFRESH_TOKEN,
  S_REDDIT_USER_AGENT,
] }, async (req: Request, res: Response) => {
  // Prefer Secret Manager values, then functions.config(), then .env
  const secretVals = await getRedditConfigFromSecrets();
  const cfgFallback = getRedditConfig();
  const redditCfg = {
    userAgent: S_REDDIT_USER_AGENT.value() || secretVals.REDDIT_USER_AGENT || cfgFallback.userAgent,
    clientId: S_REDDIT_CLIENT_ID.value() || secretVals.REDDIT_CLIENT_ID || cfgFallback.clientId,
    clientSecret: S_REDDIT_CLIENT_SECRET.value() || secretVals.REDDIT_CLIENT_SECRET || cfgFallback.clientSecret,
    refreshToken: S_REDDIT_REFRESH_TOKEN.value() || secretVals.REDDIT_REFRESH_TOKEN || cfgFallback.refreshToken,
  };

  if (!redditCfg.clientId || !redditCfg.clientSecret || !redditCfg.refreshToken) {
    res.status(500).send('Reddit credentials not configured');
    return;
  }

  try {
    const parsedSources = typeof req.query.sources === 'string' ? String(req.query.sources).split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const opt: CollectorOptions = {
      postLimit: req.query.limit ? Number(req.query.limit) : undefined,
      streams: typeof req.query.streams === 'string' ? String(req.query.streams).split(',').map(s => s.trim() as any) : undefined,
      sources: parsedSources,
      minCommentScore: req.query.minScore ? Number(req.query.minScore) : undefined,
      minAnswerLength: req.query.minLen ? Number(req.query.minLen) : undefined,
  dryRun: String(req.query.dryRun || '').toLowerCase() === 'true',
  strictMagicFlair: String(req.query.strictMagicFlair || '').toLowerCase() === 'true',
    };
    const { interactions, metrics } = await runCollector(redditCfg, opt);
    res.status(200).json({ count: interactions.length, metrics, interactions });
  } catch (err: any) {
    res.status(500).send(`Collector error: ${err?.message || err}`);
  }
});

// Scheduled function that runs every night at 02:00 UTC (cron)
// Note: scheduled (pubsub) functions require firebase-functions v2 PubSub API typings. We can add a scheduled trigger
// later after aligning SDK versions. For now we provide an HTTP manual trigger (`collectRedditMTGData`).

export function isRulesQuestion(text: string): boolean {
  const rulesIndicators = [
    'interaction', 'stack', 'resolve', 'priority', 'trigger',
    'can i', 'does this work', 'rules question', 'timing',
    'when does', 'how does', 'what happens', 'counter',
    'target', 'legal', 'allowed', 'etb', 'enters the battlefield'
  ];
  const textLower = text.toLowerCase();
  return rulesIndicators.some(ind => textLower.includes(ind));
}

function isLikelyDeckPost(text: string): boolean {
  const t = text.toLowerCase();
  const deckMarkers = [
    '[standard]', '[modern]', '[pioneer]', '[legacy]', '[draft]', '[sealed]',
    'deck tech', 'decklist', 'list:', 'moxfield.com', 'arena', 'mtga',
    'sideboard', 'sb:', 'top 8', 'tournament report', 'brew:', 'mythic', 'ladder'
  ];
  return deckMarkers.some(m => t.includes(m));
}

function hasQuestionSignal(text: string): boolean {
  const t = text.toLowerCase();
  const interrogatives = ['how does', 'what happens', 'can i', 'does this', 'when does', 'why does', 'is it legal', 'judge'];
  return t.includes('?') && interrogatives.some(i => t.includes(i));
}

// Uses submission metadata (like flair) to decide if a post is likely a rules question.
function isRulesPost(submission: any, metrics?: Record<string, number>, opts?: { strictMagicFlair?: boolean }): boolean {
  const flair: string | undefined = submission?.link_flair_text?.toString().toLowerCase();
  const title = submission?.title || '';
  const body = submission?.selftext || '';
  const text = `${title}\n${body}`;
  const subreddit = (submission?.subreddit?.display_name || submission?.subreddit?.display_name_prefixed || '').toString().toLowerCase();

  if (flair && (flair.includes('rules') || flair.includes('question'))) {
    metrics && (metrics.flair_rules = (metrics.flair_rules || 0) + 1);
    return true;
  }

  // If strict flair is requested for magicTCG, require rules-like flair
  if (opts?.strictMagicFlair && subreddit === 'magictcg') {
    return false;
  }

  if (isLikelyDeckPost(text)) {
    metrics && (metrics.excluded_decklike = (metrics.excluded_decklike || 0) + 1);
    return false;
  }

  // Accept if there's a question mark plus rules-y phrasing OR explicit rule reference
  const crRef = /\b\d{3}\.\d+[a-z]?\b/.test(text);
  const rulesWords = ['stack', 'priority', 'trigger', 'replacement effect', 'state-based action', 'target', 'copy', 'layers'];
  const hasRulesWord = rulesWords.some(w => text.toLowerCase().includes(w));
  if (crRef) return true;
  if (hasQuestionSignal(text) && hasRulesWord) return true;
  // As a final mild heuristic, allow very short titles with "rules" keyword
  if (title.toLowerCase().includes('rules')) return true;
  return false;
}

function isLowQualityBotAnswer(text: string): boolean {
  const t = text.toLowerCase();
  const urlCount = (text.match(/https?:\/\//g) || []).length;
  if (t.includes('mtgcardfetcher') || t.includes('all cards')) return true;
  if (urlCount >= 5 && t.length < 1200) return true;
  // heavy scryfall link dumps or card list formatting
  if (/\[\*all cards\*\]/i.test(text)) return true;
  return false;
}

async function getBestAnswer(submission: any, metrics?: Record<string, number>): Promise<any | null> {
  try {
    // Ensure we have a decent set of top-level comments to evaluate
    let comments: any[] = [];
    if (submission?.comments && typeof submission.comments.fetchMore === 'function') {
      const fetched = await submission.comments.fetchMore({ amount: 50, skipReplies: true });
      comments = (fetched || []).filter((c: any) => c && c.body);
    } else {
      // Fallback: refresh the submission, then try again
      await submission.refresh?.();
      if (submission?.comments && typeof submission.comments.fetchMore === 'function') {
        const fetched = await submission.comments.fetchMore({ amount: 50, skipReplies: true });
        comments = (fetched || []).filter((c: any) => c && c.body);
      } else if (Array.isArray(submission?.comments)) {
        comments = (submission.comments as any[]).filter((c: any) => c && c.body);
      }
    }

    if (!comments.length) return null;

    let bestComment: any = null;
    let bestScore = -Infinity;
    for (const comment of comments) {
      if (!comment || !comment.body) continue;
      if (isLowQualityBotAnswer(comment.body)) { metrics && (metrics.comments_skipped_low_quality = (metrics.comments_skipped_low_quality || 0) + 1); continue; }
      const judgeBonus = knownJudges.has(comment.author?.name) ? 50 : 0;
      const flairText = comment.author_flair_text?.toString().toLowerCase?.() || '';
      const judgeFlairBonus = /judge|level\s*\d|l\d/.test(flairText) ? 35 : 0;
      const ruleBonus = hasRuleReferences(comment.body) ? 20 : 0;
      const lengthBonus = Math.min((comment.body?.length || 0) / 50, 30);
      const baseScore = typeof comment.score === 'number' ? comment.score : 0;
      const totalScore = baseScore + judgeBonus + judgeFlairBonus + ruleBonus + lengthBonus;
      // track metrics if available
      metrics && (metrics.comments_scored = (metrics.comments_scored || 0) + 1);
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestComment = {
          body: comment.body,
          score: baseScore,
          author: comment.author?.name || 'deleted',
        };
      }
    }
    return bestComment;
  } catch (e) {
    console.warn('getBestAnswer failed to load or score comments', e);
    return null;
  }
}

function hasRuleReferences(text: string): boolean {
  return /\b\d{3}\.\d+[a-z]?\b/.test(text);
}

export function extractRuleReferences(text: string): string[] {
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
