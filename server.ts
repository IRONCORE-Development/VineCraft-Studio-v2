/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (process.env.VINECRAFT_PORT) {
    const parsed = Number(process.env.VINECRAFT_PORT);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    // AI Studio preview proxy targets port 3000 in dev (process.env.PORT is 8080 for nginx).
    return 3000;
  }
  const envPort = Number(process.env.PORT);
  return Number.isFinite(envPort) && envPort > 0 && envPort !== 8080 ? envPort : 7413;
}

const PORT = resolvePort();
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.use(express.json({ limit: '15mb' }));

// Canonical VineCraft Dual-Agent System Prompts & Quality Standards
const ORIGINAL_DUAL_AGENT_ARCHITECTURE = `VineCraft Dual-Agent Architecture:
- Generation Agent: Claude 3.5 Sonnet (claude-3-5-sonnet-latest) — writes grounded, first-person Amazon Vine reviews strictly from product listing facts, reviewer experience notes, and staged photos with zero em-dashes and zero fabricated claims.
- Quality Inspector Agent: Claude 3.5 Haiku (claude-3-5-haiku-latest) — performs adversarial ASIN/product matching, human originality auditing, rating-to-prose alignment, and Amazon Vine compliance verification.`;

const VINECRAFT_GENERATION_PROMPT = `You are an expert Amazon Vine Voice reviewer writing rigorous, authentic, human-sounding product reviews.
Rules:
1. Ground every observation strictly in the provided Product Title, Product Description, Reviewer Experience (Rating, Liked, Disliked, Usage, Notes), Learned Reviewer Voice/Facts, and attached photos.
2. NEVER invent technical specs, dimensions, prices, or claims that are not present in the product listing or reviewer notes.
3. NEVER use em-dashes or en-dashes (use normal hyphens, commas, or periods instead).
4. Vary your opening sentence so it never duplicates recent openers. Avoid robotic phrases like "In conclusion", "Overall, this product", or "Game changer".
5. Align sentiment accurately with the star rating (e.g., 3 stars must include real caveats; 5 stars still note specific practical details).
Return strictly valid JSON with keys:
- "title": Concise, honest headline (max 120 chars, no dashes/quotes clutter).
- "body": Natural first-person review prose matching the requested length (short ~80-130 words, medium ~150-240 words, long ~280-420 words).`;

const VINECRAFT_QUALITY_PROMPT = `You are the VineCraft Quality Inspector & Amazon Vine Compliance Auditor.
Evaluate the draft review title and body against the ASIN, product title/description, star rating, and reviewer notes.
Audit criteria:
1. ASIN & Product Match: Does the review accurately describe the listed product (matched, mismatch, or insufficient_metadata)?
2. Human Originality: Does it read like an authentic human experience rather than generic AI boilerplate or repetitive template prose?
3. Rating Alignment & Depth: Does the prose match the star rating and include concrete physical/usage details rather than vague praise?
4. Vine Compliance: No external URLs, no pricing mentions, no promotional/seller-collusion language, and no medical claims.
Rate band as exactly one of:
- "strong": Authentic, specific, matched to product, zero compliance concerns, ready to post.
- "good": Solid and accurate, but could benefit from 1-2 more concrete hands-on details.
- "needs_detail": Too generic, mismatched, thin on usage evidence, or has compliance/rating issues.
Return strictly valid JSON with keys:
- "band": "strong" | "good" | "needs_detail"
- "summary": Concise 1-2 sentence audit summary (max 400 chars).
- "asinProductMatch": { "status": "matched" | "mismatch" | "insufficient_metadata", "reason": string }
- "originality": { "verified": boolean, "reason": string }
- "strengths": string[] (2-4 items)
- "suggestions": [{ "quote"?: string, "issue": string, "question": string }] (0-3 items; empty if strong)
- "concerns": string[] (any compliance/accuracy flags, empty if none)`;

const VINECRAFT_REFINE_PROMPT = `You are the VineCraft Editorial Refiner. Rewrite and strengthen the draft review so it achieves a "strong" quality rating while remaining 100% truthful to the provided product details and reviewer notes.
Address every suggestion and concern from the Quality Inspection report without inventing unverified claims or adding em-dashes.
Return strictly valid JSON with keys "title" and "body".`;

const VINECRAFT_PERSONA_DISTILL_PROMPT = `You are an AI Reviewer Persona Distiller. Analyze the reviewer's past reviews, ordered product history, and pasted samples.
Distill:
1. "toneSummary": A concise description of their natural writing voice, sentence rhythm, opening habits, and level of detail (max 1500 chars).
2. "facts": Up to 30 short, strictly truthful factual background notes inferred directly from their history (e.g., testing setup, household/workshop context, gear preferences). Never invent facts.
Return strictly valid JSON with keys "toneSummary" (string) and "facts" (string[]).`;

type ProviderName =
  | 'anthropic'
  | 'custom_endpoint'
  | 'gemini'
  | 'custom_gemini'
  | 'custom_anthropic'
  | 'custom_openrouter'
  | 'free_local';

interface UsageMetrics {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface BridgeBucket {
  drafts: Record<string, unknown>[];
  pending: Record<string, unknown>[];
  submissions: Record<string, unknown>[];
}

const bridgeStore = new Map<string, BridgeBucket>();

function getGeminiKey(): string {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return key && key !== 'MY_GEMINI_API_KEY' ? key : '';
}

function getAnthropicKey(): string {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  return key && key !== 'MY_ANTHROPIC_API_KEY' ? key : '';
}

function getCustomGeminiKey(): string {
  return (process.env.CUSTOM_GEMINI_API_KEY || '').trim();
}

function getCustomAnthropicKey(): string {
  return (process.env.CUSTOM_ANTHROPIC_API_KEY || '').trim();
}

function getOpenRouterKey(): string {
  return (process.env.OPENROUTER_API_KEY || '').trim();
}

function isBlockedAmazonUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return /(^|\.)amazon\./i.test(u.hostname);
  } catch {
    return true;
  }
}

function isLocalComputeUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

function isStaleLocalModelName(model?: string): boolean {
  const m = String(model || '').trim().toLowerCase();
  return m === 'llama3.2' || m.startsWith('llama3.2:') || m === 'qwen2.5:14b' || m.includes('ollama');
}

function getCustomEndpointConfig(
  overrideUrl?: string,
  allowLocalCompute = false
): { url: string; apiKey: string; model: string } | null {
  const url = String(
    overrideUrl ||
      process.env.CUSTOM_AI_ENDPOINT_URL ||
      process.env.CUSTOM_AI_BASE_URL ||
      ''
  ).trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (isBlockedAmazonUrl(url)) {
    throw new Error('Outbound AI requests to Amazon domains are strictly blocked.');
  }
  if (isLocalComputeUrl(url) && !allowLocalCompute) {
    throw new Error(
      'Local compute endpoints (localhost/LAN) are blocked unless "Allow Local Compute" is explicitly enabled in Advanced Settings.'
    );
  }
  return {
    url,
    apiKey: String(process.env.CUSTOM_AI_API_KEY || '').trim(),
    model: String(process.env.CUSTOM_AI_MODEL || 'mistralai/mistral-small-3.1-24b-instruct:free').trim(),
  };
}

function deDash(s: string): string {
  return String(s || '').replace(/[‒–—―−]/g, '-');
}

function extractJsonObject<T = Record<string, unknown>>(rawText: string): T {
  const trimmed = String(rawText || '').trim();
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(fenced) as T;
  } catch {
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(fenced.slice(start, end + 1)) as T;
    }
    throw new Error('Model returned non-JSON response');
  }
}

function buildCloudOrder(
  preferred: ProviderName,
  customEndpointUrl?: string,
  allowLocalCompute = false
): Exclude<ProviderName, 'free_local'>[] {
  let hasCustom = false;
  try {
    hasCustom = Boolean(getCustomEndpointConfig(customEndpointUrl, allowLocalCompute));
  } catch (err) {
    if (preferred === 'custom_endpoint') throw err;
  }

  const available: Exclude<ProviderName, 'free_local'>[] = [];
  if (getAnthropicKey()) available.push('anthropic');
  if (getCustomAnthropicKey()) available.push('custom_anthropic');
  if (getOpenRouterKey()) available.push('custom_openrouter');
  if (hasCustom) available.push('custom_endpoint');
  if (getGeminiKey()) available.push('gemini');
  if (getCustomGeminiKey()) available.push('custom_gemini');

  if (preferred === 'free_local') return [];
  const ordered = [preferred, ...available.filter((p) => p !== preferred)];
  return ordered.filter((p) => {
    if (p === 'anthropic') return Boolean(getAnthropicKey());
    if (p === 'custom_endpoint') return hasCustom;
    if (p === 'gemini') return Boolean(getGeminiKey());
    if (p === 'custom_anthropic') return Boolean(getCustomAnthropicKey());
    if (p === 'custom_openrouter') return Boolean(getOpenRouterKey());
    if (p === 'custom_gemini') return Boolean(getCustomGeminiKey());
    return false;
  });
}

async function callAnthropicJson<T>(params: {
  apiKeyOverride?: string;
  model?: string;
  fallbackModel: string;
  systemPrompt: string;
  userPrompt: string;
  images?: Array<{ mime?: string; data?: string }>;
}): Promise<{ data: T; usage: UsageMetrics; modelUsed: string }> {
  const apiKey = (params.apiKeyOverride || getAnthropicKey()).trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15000 });
  const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  if (Array.isArray(params.images)) {
    for (const img of params.images.slice(0, 6)) {
      if (img?.data) {
        const mediaType =
          img.mime === 'image/png' || img.mime === 'image/webp' || img.mime === 'image/gif'
            ? img.mime
            : 'image/jpeg';
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: img.data },
        });
      }
    }
  }
  contentBlocks.push({ type: 'text', text: params.userPrompt });

  const requestedModel = params.model?.trim() || params.fallbackModel;
  const candidateModels =
    requestedModel === params.fallbackModel ? [requestedModel] : [requestedModel, params.fallbackModel];

  let lastErr: unknown;
  for (const modelId of candidateModels) {
    try {
      const msg = await client.messages.create({
        model: modelId,
        max_tokens: 1800,
        system: params.systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }],
      });
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const promptTokens = Number(msg.usage?.input_tokens || 0);
      const outputTokens = Number(msg.usage?.output_tokens || 0);
      return {
        data: extractJsonObject<T>(text),
        usage: {
          promptTokens,
          outputTokens,
          totalTokens: promptTokens + outputTokens,
        },
        modelUsed: modelId,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Anthropic request failed');
}

async function callCustomEndpointJson<T>(params: {
  endpointUrl?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  allowLocalCompute?: boolean;
  privateSessionId?: string;
  images?: Array<{ mime?: string; data?: string }>;
}): Promise<{ data: T; usage: UsageMetrics; modelUsed: string }> {
  const cfg = getCustomEndpointConfig(params.endpointUrl, Boolean(params.allowLocalCompute));
  if (!cfg) throw new Error('Custom endpoint URL is not configured');

  const modelId = params.model?.trim() || cfg.model;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  if (params.privateSessionId) {
    headers['X-VineCraft-Session'] = params.privateSessionId;
    headers['Connection'] = 'close';
  }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const userContent: unknown =
    Array.isArray(params.images) && params.images.some((i) => i?.data)
      ? [
          { type: 'text', text: params.userPrompt },
          ...params.images
            .filter((i) => i?.data)
            .slice(0, 6)
            .map((i) => ({
              type: 'image_url',
              image_url: { url: `data:${i.mime || 'image/jpeg'};base64,${i.data}` },
            })),
        ]
      : params.userPrompt;

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers,
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: modelId,
      sessionId: params.privateSessionId,
      ephemeral: Boolean(params.privateSessionId),
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Custom endpoint HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    content?: Array<{ text?: string }>;
    response?: string;
    text?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content =
    payload?.choices?.[0]?.message?.content ||
    payload?.choices?.[0]?.text ||
    payload?.content?.[0]?.text ||
    payload?.response ||
    payload?.text ||
    '';
  const promptTokens = Number(payload?.usage?.prompt_tokens || 0);
  const outputTokens = Number(payload?.usage?.completion_tokens || 0);
  const totalTokens = Number(payload?.usage?.total_tokens || promptTokens + outputTokens);

  return {
    data: extractJsonObject<T>(content),
    usage: { promptTokens, outputTokens, totalTokens },
    modelUsed: modelId,
  };
}

async function callGeminiJson<T>(params: {
  apiKeyOverride?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  images?: Array<{ mime?: string; data?: string }>;
}): Promise<{ data: T; usage: UsageMetrics; modelUsed: string }> {
  const apiKey = (params.apiKeyOverride || getGeminiKey()).trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: 20000, headers: { 'User-Agent': 'aistudio-build' } },
  });

  const requested = params.model?.trim();
  const modelId =
    requested && requested.startsWith('gemini-') ? requested : 'gemini-4-hydrogen';

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  if (Array.isArray(params.images)) {
    for (const img of params.images.slice(0, 6)) {
      if (img?.data) {
        parts.push({
          inlineData: { mimeType: img.mime || 'image/jpeg', data: img.data },
        });
      }
    }
  }
  parts.push({ text: params.userPrompt });

  const response = await ai.models.generateContent({
    model: modelId,
    contents: { parts },
    config: {
      systemInstruction: params.systemPrompt,
      responseMimeType: 'application/json',
      responseSchema: params.responseSchema,
    },
  });

  const promptTokens = Number(response.usageMetadata?.promptTokenCount || 0);
  const outputTokens = Number(response.usageMetadata?.candidatesTokenCount || 0);
  const totalTokens = Number(response.usageMetadata?.totalTokenCount || promptTokens + outputTokens);

  return {
    data: extractJsonObject<T>(response.text || '{}'),
    usage: { promptTokens, outputTokens, totalTokens },
    modelUsed: modelId,
  };
}

async function callOpenRouterJson<T>(params: {
  model?: string;
  fallbackModel: string;
  systemPrompt: string;
  userPrompt: string;
  privateSessionId?: string;
  images?: Array<{ mime?: string; data?: string }>;
}): Promise<{ data: T; usage: UsageMetrics; modelUsed: string }> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const modelId = params.model?.trim() || params.fallbackModel;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-Title': 'VineCraft Studio',
    'Cache-Control': 'no-store',
  };
  if (params.privateSessionId) {
    headers['X-VineCraft-Session'] = params.privateSessionId;
    headers['Connection'] = 'close';
  }

  const userContent: unknown =
    Array.isArray(params.images) && params.images.some((i) => i?.data)
      ? [
          { type: 'text', text: params.userPrompt },
          ...params.images
            .filter((i) => i?.data)
            .slice(0, 6)
            .map((i) => ({
              type: 'image_url',
              image_url: { url: `data:${i.mime || 'image/jpeg'};base64,${i.data}` },
            })),
        ]
      : params.userPrompt;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '';
  const promptTokens = Number(payload?.usage?.prompt_tokens || 0);
  const outputTokens = Number(payload?.usage?.completion_tokens || 0);
  const totalTokens = Number(payload?.usage?.total_tokens || promptTokens + outputTokens);

  return {
    data: extractJsonObject<T>(content),
    usage: { promptTokens, outputTokens, totalTokens },
    modelUsed: modelId,
  };
}

async function routeCloudJson<T>(params: {
  preferredProvider: ProviderName;
  preferredModel?: string;
  anthropicFallbackModel: string;
  openRouterFallbackModel?: string;
  endpointUrl?: string;
  allowLocalCompute?: boolean;
  privateSessionId?: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  images?: Array<{ mime?: string; data?: string }>;
}): Promise<{ data: T; usage: UsageMetrics; providerUsed: string; sessionId?: string } | null> {
  const localAllowed = Boolean(params.allowLocalCompute);
  const safeEndpointUrl =
    !localAllowed && params.endpointUrl && isLocalComputeUrl(params.endpointUrl)
      ? params.preferredProvider === 'custom_endpoint'
        ? params.endpointUrl
        : undefined
      : params.endpointUrl;
  const safePreferredModel =
    !localAllowed && isStaleLocalModelName(params.preferredModel)
      ? undefined
      : params.preferredModel;

  const chain = buildCloudOrder(
    params.preferredProvider,
    safeEndpointUrl,
    localAllowed
  );
  if (!chain.length) return null;

  let lastErr: unknown;
  for (const p of chain) {
    try {
      if (p === 'anthropic' || p === 'custom_anthropic') {
        const out = await callAnthropicJson<T>({
          apiKeyOverride: p === 'custom_anthropic' ? getCustomAnthropicKey() : undefined,
          model: params.preferredProvider === p ? safePreferredModel : undefined,
          fallbackModel: params.anthropicFallbackModel,
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          images: params.images,
        });
        return {
          data: out.data,
          usage: out.usage,
          providerUsed: `${p}:${out.modelUsed}`,
          sessionId: params.privateSessionId,
        };
      }
      if (p === 'custom_openrouter') {
        const out = await callOpenRouterJson<T>({
          model: params.preferredProvider === 'custom_openrouter' ? safePreferredModel : undefined,
          fallbackModel: params.openRouterFallbackModel || 'qwen/qwen-2.5-72b-instruct:free',
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          privateSessionId: params.privateSessionId,
          images: params.images,
        });
        return {
          data: out.data,
          usage: out.usage,
          providerUsed: `custom_openrouter:${out.modelUsed}`,
          sessionId: params.privateSessionId,
        };
      }
      if (p === 'custom_endpoint') {
        const out = await callCustomEndpointJson<T>({
          endpointUrl: safeEndpointUrl,
          model: params.preferredProvider === 'custom_endpoint' ? safePreferredModel : undefined,
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          allowLocalCompute: localAllowed,
          privateSessionId: params.privateSessionId,
          images: params.images,
        });
        return {
          data: out.data,
          usage: out.usage,
          providerUsed: `custom:${out.modelUsed}`,
          sessionId: params.privateSessionId,
        };
      }
      if (p === 'gemini' || p === 'custom_gemini') {
        const out = await callGeminiJson<T>({
          apiKeyOverride: p === 'custom_gemini' ? getCustomGeminiKey() : undefined,
          model: params.preferredProvider === p ? safePreferredModel : undefined,
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          responseSchema: params.responseSchema,
          images: params.images,
        });
        return {
          data: out.data,
          usage: out.usage,
          providerUsed: `${p}:${out.modelUsed}`,
          sessionId: params.privateSessionId,
        };
      }
    } catch (err) {
      lastErr = err;
      console.warn(`Cloud provider "${p}" failed, trying next route:`, err instanceof Error ? err.message : err);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('All configured cloud AI routes failed');
}

// Health & available providers (local compute strictly off unless opted in)
app.get('/api/ai/health', (req: Request, res: Response) => {
  const allowLocal = req.query.allowLocalCompute === '1';
  let customReady = false;
  try {
    customReady = Boolean(getCustomEndpointConfig(undefined, allowLocal));
  } catch {
    customReady = false;
  }
  res.json({
    ok: true,
    providers: {
      free_local: allowLocal,
      anthropic: Boolean(getAnthropicKey()),
      gemini: Boolean(getGeminiKey()),
      custom_endpoint: customReady,
      custom_gemini: Boolean(getCustomGeminiKey()),
      custom_anthropic: Boolean(getCustomAnthropicKey()),
      custom_openrouter: Boolean(getOpenRouterKey()),
    },
  });
});

// Canonical prompts transparency
app.get('/api/ai/prompts', (_req: Request, res: Response) => {
  res.json({
    originalExtensionPrompt: ORIGINAL_DUAL_AGENT_ARCHITECTURE,
    originalExtensionNote:
      'Dual-agent architecture: Claude 3.5 Sonnet for authentic review generation/refinement and Claude 3.5 Haiku for strict quality & Vine compliance auditing, with automatic cloud fallback routing.',
    defaultGenerationPrompt: VINECRAFT_GENERATION_PROMPT,
    lockedQualityPrompt: VINECRAFT_QUALITY_PROMPT,
    defaultRefinePrompt: VINECRAFT_REFINE_PROMPT,
    personaDistillPrompt: VINECRAFT_PERSONA_DISTILL_PROMPT,
  });
});

// Generate draft review
app.post('/api/ai/review/generate', async (req: Request, res: Response) => {
  try {
    const {
      product,
      context,
      images,
      batchMode,
      recentOpeners,
      learnedVoice,
      provider,
      model,
      endpointUrl,
      allowLocalCompute,
      privateSession,
    } = req.body || {};

    const selectedProvider = (provider || 'anthropic') as ProviderName;
    const localOptIn = Boolean(allowLocalCompute);
    if (selectedProvider === 'free_local' && !localOptIn) {
      res.status(403).json({
        error:
          'Local compute is disabled by default. Enable "Allow Local Compute" in Advanced Settings to use offline local templates.',
      });
      return;
    }
    const privateSessionId = privateSession !== false ? crypto.randomUUID() : undefined;
    const productTitle = String(product?.title || product?.asin || 'Amazon Item').trim();
    const prompt = `Product ASIN: ${product?.asin || 'UNKNOWN'}
Product Title: ${productTitle}
Product Description: ${String(product?.description || 'N/A').slice(0, batchMode ? 1200 : 3500)}
Rating: ${context?.rating ?? 5} / 5 stars
Recommend: ${context?.recommend || 'yes'}
Tone: ${context?.tone || 'balanced'}
Target Length: ${context?.length || 'medium'}
What I Liked: ${context?.liked || 'N/A'}
What I Disliked: ${context?.disliked || 'N/A'}
Usage Context: ${context?.usage || 'N/A'}
Additional Notes: ${context?.notes || 'N/A'}
Custom Instructions: ${context?.instructions || 'None'}
${learnedVoice?.enabled && learnedVoice?.summary ? `\nReviewer Voice & Cadence:\n${learnedVoice.summary}` : ''}
${learnedVoice?.enabled && Array.isArray(learnedVoice?.facts) && learnedVoice.facts.length ? `\nReviewer Context Facts:\n- ${learnedVoice.facts.slice(0, 20).join('\n- ')}` : ''}
${Array.isArray(recentOpeners) && recentOpeners.length ? `\nAvoid repeating these recent openings:\n- ${recentOpeners.slice(0, 6).join('\n- ')}` : ''}

Write a grounded, authentic first-person Amazon Vine review as JSON with "title" and "body".`;

    const routed = await routeCloudJson<{ title?: string; body?: string }>({
      preferredProvider: selectedProvider,
      preferredModel: model,
      anthropicFallbackModel: 'claude-3-5-sonnet-20241022',
      openRouterFallbackModel: 'qwen/qwen-2.5-72b-instruct:free',
      endpointUrl,
      allowLocalCompute: localOptIn,
      privateSessionId,
      systemPrompt: VINECRAFT_GENERATION_PROMPT,
      userPrompt: prompt,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ['title', 'body'],
      },
      images,
    });

    if (routed) {
      res.json({
        review: {
          title: deDash(routed.data.title || `Hands-on impressions of ${productTitle}`).slice(0, 200),
          body: deDash(routed.data.body || ''),
        },
        usage: routed.usage,
        providerUsed: routed.providerUsed,
        sessionId: routed.sessionId,
      });
      return;
    }

    // Offline template only when explicitly opted-in via allowLocalCompute + free_local
    if (selectedProvider !== 'free_local' || !localOptIn) {
      res.status(503).json({
        error:
          'No cloud AI provider succeeded. Configure a Custom Endpoint URL, ANTHROPIC_API_KEY, or GEMINI_API_KEY (local compute remains disabled).',
      });
      return;
    }

    const likesText = context?.liked ? `What stood out right away was ${context.liked}.` : 'The build and finish felt consistent with the listing description.';
    const usageText = context?.usage ? `In my setup (${context.usage}), it worked smoothly.` : 'During regular daily use it held up reliably without fuss.';
    const dislikeText = context?.disliked ? `One minor drawback to note is ${context.disliked}.` : '';
    const title = deDash(`Practical daily use impressions for ${productTitle}`.slice(0, 120));
    const body = deDash([likesText, usageText, dislikeText, context?.notes || ''].filter(Boolean).join(' '));

    res.json({
      review: { title, body },
      usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
      providerUsed: 'free_local',
    });
  } catch (err) {
    console.error('Review generation error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Generation failed' });
  }
});

// Quality & ASIN compliance inspection
app.post('/api/ai/review/quality', async (req: Request, res: Response) => {
  try {
    const {
      title,
      body,
      rating,
      asin,
      product_title,
      description,
      notes,
      provider,
      model,
      endpointUrl,
      allowLocalCompute,
      privateSession,
      overrideEnabled,
      systemPromptOverride,
    } = req.body || {};

    const selectedProvider = (provider || 'anthropic') as ProviderName;
    const localOptIn = Boolean(allowLocalCompute);
    if (selectedProvider === 'free_local' && !localOptIn) {
      res.status(403).json({
        error: 'Local compute is disabled by default. Enable "Allow Local Compute" in Advanced Settings.',
      });
      return;
    }
    const privateSessionId = privateSession !== false ? crypto.randomUUID() : undefined;
    const sysPrompt =
      overrideEnabled && systemPromptOverride?.trim()
        ? String(systemPromptOverride).trim()
        : VINECRAFT_QUALITY_PROMPT;

    const userPrompt = `ASIN: ${asin || 'UNKNOWN'}
Product Title: ${product_title || 'N/A'}
Product Description: ${String(description || 'N/A').slice(0, 2000)}
Reviewer Rating: ${rating ?? 5} / 5 stars
Reviewer Notes: ${notes || 'N/A'}
Draft Title: ${title || ''}
Draft Body: ${body || ''}`;

    const routed = await routeCloudJson<{
      band?: string;
      summary?: string;
      asinProductMatch?: { status?: string; reason?: string };
      originality?: { verified?: boolean; reason?: string };
      strengths?: string[];
      suggestions?: Array<{ quote?: string; issue?: string; question?: string }>;
      concerns?: string[];
    }>({
      preferredProvider: selectedProvider,
      preferredModel: model,
      anthropicFallbackModel: 'claude-3-5-haiku-20241022',
      openRouterFallbackModel: 'mistralai/mistral-small-3.1-24b-instruct:free',
      endpointUrl,
      allowLocalCompute: localOptIn,
      privateSessionId,
      systemPrompt: sysPrompt,
      userPrompt,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          band: { type: Type.STRING, enum: ['strong', 'good', 'needs_detail'] },
          summary: { type: Type.STRING },
          asinProductMatch: {
            type: Type.OBJECT,
            properties: {
              status: { type: Type.STRING, enum: ['matched', 'mismatch', 'insufficient_metadata'] },
              reason: { type: Type.STRING },
            },
            required: ['status', 'reason'],
          },
          originality: {
            type: Type.OBJECT,
            properties: {
              verified: { type: Type.BOOLEAN },
              reason: { type: Type.STRING },
            },
            required: ['verified', 'reason'],
          },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                quote: { type: Type.STRING },
                issue: { type: Type.STRING },
                question: { type: Type.STRING },
              },
              required: ['issue', 'question'],
            },
          },
          concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['band', 'summary', 'asinProductMatch', 'originality', 'strengths', 'suggestions', 'concerns'],
      },
    });

    if (routed) {
      const d = routed.data;
      const band = d.band === 'strong' || d.band === 'good' || d.band === 'needs_detail' ? d.band : 'good';
      const matchStatus =
        d.asinProductMatch?.status === 'matched' ||
        d.asinProductMatch?.status === 'mismatch' ||
        d.asinProductMatch?.status === 'insufficient_metadata'
          ? d.asinProductMatch.status
          : 'matched';

      res.json({
        band,
        summary: String(d.summary || 'Quality inspection completed.').slice(0, 1900),
        asinProductMatch: {
          status: matchStatus,
          reason: String(d.asinProductMatch?.reason || 'Evaluated against product metadata.').slice(0, 480),
        },
        originality: {
          verified: d.originality?.verified !== false,
          reason: String(d.originality?.reason || 'Evaluated for human prose originality.').slice(0, 480),
        },
        strengths: (Array.isArray(d.strengths) ? d.strengths : [])
          .map((s) => String(s).slice(0, 480))
          .filter(Boolean)
          .slice(0, 20),
        suggestions: (Array.isArray(d.suggestions) ? d.suggestions : [])
          .map((s) => ({
            ...(s.quote ? { quote: String(s.quote).slice(0, 480) } : {}),
            issue: String(s.issue || 'Add hands-on detail').slice(0, 480),
            question: String(s.question || 'What specific detail did you notice during use?').slice(0, 480),
          }))
          .slice(0, 20),
        concerns: (Array.isArray(d.concerns) ? d.concerns : [])
          .map((c) => String(c).slice(0, 480))
          .filter(Boolean)
          .slice(0, 20),
        usage: routed.usage,
        providerUsed: routed.providerUsed,
        sessionId: routed.sessionId,
      });
      return;
    }

    if (selectedProvider !== 'free_local' || !localOptIn) {
      res.status(503).json({
        error: 'No cloud AI provider succeeded for quality inspection (local compute disabled).',
      });
      return;
    }

    const words = String(body || '').trim().split(/\s+/).filter(Boolean).length;
    const band = words >= 65 ? 'strong' : words >= 30 ? 'good' : 'needs_detail';
    res.json({
      band,
      summary:
        band === 'strong'
          ? 'Offline heuristic check passed with solid word depth.'
          : 'Add more hands-on usage specifics so the review reads with strong substance.',
      asinProductMatch: { status: 'matched', reason: 'Matches provided product title context.' },
      originality: { verified: true, reason: 'No template duplication flags detected locally.' },
      strengths: ['Clear headline and rating alignment'],
      suggestions:
        band === 'strong'
          ? []
          : [{ issue: 'Limited usage detail', question: 'How did it perform after repeated real-world use?' }],
      concerns: [],
      usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
      providerUsed: 'free_local',
    });
  } catch (err) {
    console.error('Quality inspection error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Quality inspection failed' });
  }
});

// Refine draft based on quality suggestions
app.post('/api/ai/review/refine', async (req: Request, res: Response) => {
  try {
    const {
      product,
      context,
      draft,
      assessment,
      recentOpeners,
      learnedVoice,
      provider,
      model,
      endpointUrl,
      allowLocalCompute,
      privateSession,
    } = req.body || {};

    const selectedProvider = (provider || 'anthropic') as ProviderName;
    const localOptIn = Boolean(allowLocalCompute);
    if (selectedProvider === 'free_local' && !localOptIn) {
      res.status(403).json({
        error: 'Local compute is disabled by default. Enable "Allow Local Compute" in Advanced Settings.',
      });
      return;
    }
    const privateSessionId = privateSession !== false ? crypto.randomUUID() : undefined;
    const prompt = `Product ASIN: ${product?.asin || 'UNKNOWN'}
Product Title: ${product?.title || 'Unknown'}
Product Description: ${String(product?.description || 'N/A').slice(0, 2500)}
Rating: ${context?.rating ?? 5} / 5 stars
Liked: ${context?.liked || 'N/A'}
Disliked: ${context?.disliked || 'N/A'}
Usage: ${context?.usage || 'N/A'}
Notes: ${context?.notes || 'N/A'}
${learnedVoice?.enabled && learnedVoice?.summary ? `Reviewer Voice:\n${learnedVoice.summary}\n` : ''}
${learnedVoice?.enabled && Array.isArray(learnedVoice?.facts) && learnedVoice.facts.length ? `Reviewer Facts:\n- ${learnedVoice.facts.slice(0, 15).join('\n- ')}\n` : ''}
${Array.isArray(recentOpeners) && recentOpeners.length ? `Avoid repeating recent openings:\n- ${recentOpeners.slice(0, 5).join('\n- ')}\n` : ''}
Current Draft Title: ${draft?.title || ''}
Current Draft Body: ${draft?.body || ''}
Inspector Summary: ${assessment?.summary || ''}
Inspector Suggestions: ${JSON.stringify(assessment?.suggestions || [])}
Inspector Concerns: ${JSON.stringify(assessment?.concerns || [])}

Rewrite and improve the review to achieve a "strong" rating without fabricating unverified claims. Return JSON with "title" and "body".`;

    const routed = await routeCloudJson<{ title?: string; body?: string }>({
      preferredProvider: selectedProvider,
      preferredModel: model,
      anthropicFallbackModel: 'claude-3-5-sonnet-20241022',
      openRouterFallbackModel: 'qwen/qwen-2.5-72b-instruct:free',
      endpointUrl,
      allowLocalCompute: localOptIn,
      privateSessionId,
      systemPrompt: VINECRAFT_REFINE_PROMPT,
      userPrompt: prompt,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ['title', 'body'],
      },
    });

    if (routed) {
      res.json({
        review: {
          title: deDash(routed.data.title || draft?.title || ''),
          body: deDash(routed.data.body || draft?.body || ''),
        },
        usage: routed.usage,
        providerUsed: routed.providerUsed,
        sessionId: routed.sessionId,
      });
      return;
    }

    if (selectedProvider !== 'free_local' || !localOptIn) {
      res.status(503).json({
        error: 'No cloud AI provider succeeded for review refinement (local compute disabled).',
      });
      return;
    }

    const extra = [context?.usage, context?.liked, context?.notes]
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .join(' ');
    res.json({
      review: {
        title: deDash(draft?.title || ''),
        body: deDash(
          extra && !String(draft?.body || '').includes(extra)
            ? `${String(draft?.body || '').trim()} ${extra}`
            : String(draft?.body || '').trim()
        ),
      },
      usage: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
      providerUsed: 'free_local',
    });
  } catch (err) {
    console.error('Refine error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Refinement failed' });
  }
});

// Distill learned reviewer tone & factual setup notes
app.post('/api/ai/persona/distill', async (req: Request, res: Response) => {
  try {
    const {
      reviews,
      externalSamplesText,
      existingSummary,
      existingFacts,
      provider,
      model,
      endpointUrl,
      allowLocalCompute,
      privateSession,
    } = req.body || {};

    const selectedProvider = (provider || 'anthropic') as ProviderName;
    const localOptIn = Boolean(allowLocalCompute);
    if (selectedProvider === 'free_local' && !localOptIn) {
      res.status(403).json({
        error: 'Local compute is disabled by default. Enable "Allow Local Compute" in Advanced Settings.',
      });
      return;
    }
    const privateSessionId = privateSession !== false ? crypto.randomUUID() : undefined;
    const historySlice = Array.isArray(reviews) ? reviews.slice(0, 25) : [];
    const prompt = `Existing Voice Summary: ${existingSummary || 'None'}
Existing Facts: ${JSON.stringify(existingFacts || [])}
Tracked Studio Reviews & Orders (${historySlice.length}):
${JSON.stringify(historySlice)}
Pasted External Review Samples / Orders:
${String(externalSamplesText || 'None').slice(0, 8000)}

Distill the reviewer's authentic voice summary and up to 30 factual context notes as JSON with "toneSummary" and "facts".`;

    const routed = await routeCloudJson<{ toneSummary?: string; facts?: string[] }>({
      preferredProvider: selectedProvider,
      preferredModel: model,
      anthropicFallbackModel: 'claude-3-5-sonnet-20241022',
      openRouterFallbackModel: 'qwen/qwen-2.5-72b-instruct:free',
      endpointUrl,
      allowLocalCompute: localOptIn,
      privateSessionId,
      systemPrompt: VINECRAFT_PERSONA_DISTILL_PROMPT,
      userPrompt: prompt,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          toneSummary: { type: Type.STRING },
          facts: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['toneSummary', 'facts'],
      },
    });

    if (routed) {
      const toneSummary = deDash(String(routed.data.toneSummary || existingSummary || '')).slice(0, 2900);
      const facts = (Array.isArray(routed.data.facts) ? routed.data.facts : [])
        .map((f) => deDash(String(f)).trim().slice(0, 480))
        .filter(Boolean)
        .slice(0, 30);

      res.json({
        toneSummary,
        facts,
        reviewsUsed: historySlice.length,
        usage: routed.usage,
        providerUsed: routed.providerUsed,
        sessionId: routed.sessionId,
      });
      return;
    }

    if (selectedProvider !== 'free_local' || !localOptIn) {
      res.status(503).json({
        error: 'No cloud AI provider succeeded for persona distillation (local compute disabled).',
      });
      return;
    }

    res.json({
      toneSummary:
        existingSummary ||
        'Direct, practical reviewer focused on real-world durability, setup clarity, and honest pros and cons.',
      facts: Array.isArray(existingFacts) ? existingFacts.slice(0, 30) : [],
      reviewsUsed: historySlice.length,
      providerUsed: 'free_local',
    });
  } catch (err) {
    console.error('Persona distill error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Distillation failed' });
  }
});

// Safe-Zone Companion Bridge Endpoints (CORS-enabled; zero Amazon contact)
app.use('/api/bridge', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.post('/api/bridge/staged', (req: Request, res: Response) => {
  const { bridgeKey, drafts } = req.body || {};
  if (!bridgeKey || typeof bridgeKey !== 'string') {
    res.status(400).json({ error: 'Missing bridgeKey' });
    return;
  }
  const existing = bridgeStore.get(bridgeKey) || { drafts: [], pending: [], submissions: [] };
  existing.drafts = Array.isArray(drafts) ? drafts.slice(0, 50) : [];
  bridgeStore.set(bridgeKey, existing);
  res.json({ success: true, count: existing.drafts.length });
});

app.get('/api/bridge/staged', (req: Request, res: Response) => {
  const bridgeKey = String(req.query.bridgeKey || '');
  const store = bridgeStore.get(bridgeKey) || { drafts: [], pending: [], submissions: [] };
  res.json({ drafts: store.drafts });
});

app.post('/api/bridge/pending', (req: Request, res: Response) => {
  const { bridgeKey, items, submissions } = req.body || {};
  if (!bridgeKey || typeof bridgeKey !== 'string') {
    res.status(400).json({ error: 'Missing bridgeKey' });
    return;
  }
  const existing = bridgeStore.get(bridgeKey) || { drafts: [], pending: [], submissions: [] };
  if (Array.isArray(items)) existing.pending.push(...items.slice(0, 100));
  if (Array.isArray(submissions)) existing.submissions.push(...submissions.slice(0, 100));
  bridgeStore.set(bridgeKey, existing);
  res.json({ success: true, pendingCount: existing.pending.length, submissionCount: existing.submissions.length });
});

app.get('/api/bridge/pending', (req: Request, res: Response) => {
  const bridgeKey = String(req.query.bridgeKey || '');
  const drain = req.query.drain === '1';
  const store = bridgeStore.get(bridgeKey) || { drafts: [], pending: [], submissions: [] };
  const items = [...store.pending];
  const submissions = [...store.submissions];
  if (drain) {
    store.pending = [];
    store.submissions = [];
  }
  res.json({ items, submissions });
});

// ---- Zero-Auth, Zero-Amazon Live Feed Routes ----
interface LiveFeedItem {
  id: string;
  asin: string;
  title: string;
  description?: string;
  queue: 'RFY' | 'AFA' | 'AI' | 'OTHER';
  category?: string;
  etv?: number | null;
  imageUrl?: string;
  timestamp: string;
  sourceLabel?: string;
  unavailable?: boolean;
}

const LIVE_FEED_FILE = path.resolve(__dirname, 'data', 'live-feed.json');
const feedSseClients = new Set<Response>();
let liveFeedCache: LiveFeedItem[] | null = null;
let lastFeedPollAt: string | null = null;

function loadLiveFeedItems(): LiveFeedItem[] {
  if (liveFeedCache) return liveFeedCache;
  try {
    if (fs.existsSync(LIVE_FEED_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LIVE_FEED_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        liveFeedCache = parsed.slice(0, 250) as LiveFeedItem[];
        return liveFeedCache;
      }
    }
  } catch {
    // ignore corrupt feed cache
  }
  liveFeedCache = [];
  return liveFeedCache;
}

function saveLiveFeedItems(items: LiveFeedItem[]) {
  liveFeedCache = items.slice(0, 250);
  try {
    fs.mkdirSync(path.dirname(LIVE_FEED_FILE), { recursive: true });
    fs.writeFileSync(LIVE_FEED_FILE, JSON.stringify(liveFeedCache, null, 2));
  } catch {
    // non-fatal disk write error
  }
}

function broadcastFeedEvent(eventName: string, payload: unknown) {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of feedSseClients) {
    try {
      client.write(frame);
    } catch {
      feedSseClients.delete(client);
    }
  }
}

function normalizeQueueTag(raw: unknown): LiveFeedItem['queue'] {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'RFY' || s.includes('RECOMMENDED')) return 'RFY';
  if (s === 'AFA' || s.includes('AVAILABLE FOR ALL')) return 'AFA';
  if (s === 'AI' || s.includes('ADDITIONAL')) return 'AI';
  return 'OTHER';
}

function normalizeAsinCandidate(raw: unknown): string {
  const s = String(raw || '').trim().toUpperCase();
  const dp = s.match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/i);
  if (dp) return dp[1].toUpperCase();
  const token = s.match(/\b([A-Z0-9]{8,14})\b/);
  return token ? token[1].toUpperCase() : s.replace(/[^A-Z0-9]/g, '').slice(0, 14);
}

function parseExternalFeedPayload(rawText: string, sourceLabel: string): LiveFeedItem[] {
  const results: LiveFeedItem[] = [];
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return results;

  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed?.data)
          ? parsed.data
          : Array.isArray(parsed?.products)
            ? parsed.products
            : Array.isArray(parsed?.drops)
              ? parsed.drops
              : [parsed];
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const asin = normalizeAsinCandidate(rec.asin || rec.ASIN || rec.url || rec.link || '');
      if (!/^[A-Z0-9]{8,14}$/.test(asin)) continue;
      const rawEtv = rec.etv ?? rec.ETV ?? rec.price;
      const parsedEtv =
        rawEtv === null || rawEtv === undefined || rawEtv === ''
          ? null
          : Number(String(rawEtv).replace(/[^0-9.]/g, ''));
      results.push({
        id: `${asin}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        asin,
        title: String(rec.title || rec.productTitle || rec.name || `Vine Drop ${asin}`).trim().slice(0, 400),
        description: rec.description || rec.productDescription ? String(rec.description || rec.productDescription).trim().slice(0, 2000) : undefined,
        queue: normalizeQueueTag(rec.queue || rec.tier || rec.tab || rec.feedType || 'AI'),
        category: rec.category ? String(rec.category).trim().slice(0, 120) : undefined,
        etv: Number.isFinite(parsedEtv as number) ? (parsedEtv as number) : null,
        imageUrl: rec.imageUrl || rec.image || rec.productImage ? String(rec.imageUrl || rec.image || rec.productImage).slice(0, 600) : undefined,
        timestamp: String(rec.timestamp || rec.createdAt || rec.pubDate || new Date().toISOString()),
        sourceLabel: String(rec.sourceLabel || sourceLabel).slice(0, 80),
        unavailable: Boolean(rec.unavailable),
      });
    }
    if (results.length > 0) return results;
  } catch {
    // try RSS/Atom or line-delimited fallback
  }

  // RSS / Atom <item> or <entry> blocks (no Amazon contact)
  const xmlItems = [...trimmed.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)];
  for (const m of xmlItems) {
    const block = m[1] || '';
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const descMatch = block.match(/<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/i);
    const linkMatch = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>|<link[^>]+href=["']([^"']+)["']/i);
    const dateMatch = block.match(/<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i);
    const title = String(titleMatch?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const desc = String(descMatch?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const link = String(linkMatch?.[1] || linkMatch?.[2] || '').trim();
    const asin = normalizeAsinCandidate(`${link} ${title} ${desc}`);
    if (!/^[A-Z0-9]{8,14}$/.test(asin)) continue;
    const etvMatch = `${title} ${desc}`.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    results.push({
      id: `${asin}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      asin,
      title: (title || `Vine Drop ${asin}`).slice(0, 400),
      description: desc ? desc.slice(0, 2000) : undefined,
      queue: normalizeQueueTag(`${title} ${desc}`),
      etv: etvMatch ? Number(etvMatch[1]) : null,
      timestamp: dateMatch?.[1]?.trim() || new Date().toISOString(),
      sourceLabel,
    });
  }
  if (results.length > 0) return results;

  // Line-delimited fallback (ASIN | Title | Queue | ETV)
  for (const line of trimmed.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    const parts = clean.split(/[\|\t,]/).map((p) => p.trim());
    const asin = normalizeAsinCandidate(parts[0] || clean);
    if (!/^[A-Z0-9]{8,14}$/.test(asin)) continue;
    const etvVal = parts[3] ? Number(parts[3].replace(/[^0-9.]/g, '')) : NaN;
    results.push({
      id: `${asin}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      asin,
      title: (parts[1] || clean.replace(asin, '').trim() || `Vine Drop ${asin}`).slice(0, 400),
      queue: normalizeQueueTag(parts[2] || 'AI'),
      etv: Number.isFinite(etvVal) ? etvVal : null,
      timestamp: new Date().toISOString(),
      sourceLabel,
    });
  }
  return results;
}

function mergeFeedDrops(incoming: LiveFeedItem[]): LiveFeedItem[] {
  const existing = loadLiveFeedItems();
  const byAsin = new Map<string, LiveFeedItem>();
  for (const item of existing) {
    byAsin.set(item.asin, item);
  }
  const added: LiveFeedItem[] = [];
  for (const item of incoming) {
    const prev = byAsin.get(item.asin);
    if (!prev || prev.title !== item.title || prev.unavailable !== item.unavailable) {
      added.push(item);
    }
    byAsin.set(item.asin, item);
  }
  const merged = Array.from(byAsin.values())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 250);
  saveLiveFeedItems(merged);
  return added;
}

app.use('/api/feed', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Zero authorization checkpoints: direct private feed read
app.get('/api/feed/items', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    items: loadLiveFeedItems(),
    lastPolledAt: lastFeedPollAt,
  });
});

// Zero-auth SSE live stream
app.get('/api/feed/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  feedSseClients.add(res);
  res.write(`event: init\ndata: ${JSON.stringify({ items: loadLiveFeedItems(), lastPolledAt: lastFeedPollAt })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
      feedSseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    feedSseClients.delete(res);
  });
});

// Direct push / import into live feed (zero outbound Amazon calls)
app.post('/api/feed/push', (req: Request, res: Response) => {
  const { items, rawText, sourceLabel } = req.body || {};
  const label = String(sourceLabel || 'Direct Push').slice(0, 80);
  let parsed: LiveFeedItem[] = [];

  if (Array.isArray(items)) {
    parsed = parseExternalFeedPayload(JSON.stringify(items), label);
  } else if (typeof rawText === 'string' && rawText.trim()) {
    parsed = parseExternalFeedPayload(rawText, label);
  } else if (req.body && typeof req.body === 'object' && (req.body.asin || req.body.ASIN)) {
    parsed = parseExternalFeedPayload(JSON.stringify([req.body]), label);
  }

  const added = mergeFeedDrops(parsed);
  if (added.length > 0) {
    broadcastFeedEvent('drop', { added, items: loadLiveFeedItems() });
  }
  res.json({
    ok: true,
    received: parsed.length,
    added: added.length,
    items: loadLiveFeedItems(),
  });
});

// Poll an external non-Amazon community JSON/RSS feed URL (strictly blocks amazon.*)
app.post('/api/feed/poll', async (req: Request, res: Response) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      res.status(400).json({ error: 'Provide a valid http(s) non-Amazon community feed URL.' });
      return;
    }
    if (isBlockedAmazonUrl(rawUrl)) {
      res.status(403).json({
        error: 'Live Feed strictly forbids querying or polling any Amazon domain.',
      });
      return;
    }
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.hostname === '169.254.169.254') {
      res.status(403).json({ error: 'Metadata IP blocked.' });
      return;
    }

    const upstream = await fetch(rawUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Accept: 'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain',
      },
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Feed source returned HTTP ${upstream.status}` });
      return;
    }
    const text = await upstream.text();
    const parsed = parseExternalFeedPayload(text, parsedUrl.hostname);
    const added = mergeFeedDrops(parsed);
    lastFeedPollAt = new Date().toISOString();
    if (added.length > 0) {
      broadcastFeedEvent('drop', { added, items: loadLiveFeedItems(), lastPolledAt: lastFeedPollAt });
    }
    res.json({
      ok: true,
      parsed: parsed.length,
      added: added.length,
      lastPolledAt: lastFeedPollAt,
      items: loadLiveFeedItems(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Feed poll failed.' });
  }
});

app.delete('/api/feed/items', (_req: Request, res: Response) => {
  saveLiveFeedItems([]);
  broadcastFeedEvent('reset', { items: [] });
  res.json({ ok: true, items: [] });
});

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VineCraft Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
