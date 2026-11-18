import { QualityAssessment } from '../types';

export type WebHandoffTarget = 'claude' | 'duck' | 'qwen' | 'mistral' | 'chatgpt' | 'gemini';

export interface WebHandoffProviderMeta {
  id: WebHandoffTarget;
  label: string;
  buildUrl: (prompt: string) => string;
  supportsQueryPrefill: boolean;
}

export const WEB_HANDOFF_PROVIDERS: WebHandoffProviderMeta[] = [
  {
    id: 'claude',
    label: 'Claude.ai',
    buildUrl: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt.slice(0, 5500))}`,
    supportsQueryPrefill: true,
  },
  {
    id: 'duck',
    label: 'Duck.ai',
    buildUrl: (prompt) => `https://duck.ai/?q=${encodeURIComponent(prompt.slice(0, 3500))}`,
    supportsQueryPrefill: true,
  },
  {
    id: 'qwen',
    label: 'Qwen',
    buildUrl: () => 'https://chat.qwen.ai/',
    supportsQueryPrefill: false,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    buildUrl: () => 'https://chat.mistral.ai/',
    supportsQueryPrefill: false,
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    buildUrl: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt.slice(0, 5500))}`,
    supportsQueryPrefill: true,
  },
  {
    id: 'gemini',
    label: 'Gemini Web',
    buildUrl: () => 'https://gemini.google.com/app',
    supportsQueryPrefill: false,
  },
];

function deDash(s: string): string {
  return String(s || '').replace(/[‒–—―−]/g, '-');
}

export interface ParsedWebDraft {
  kind: 'draft';
  title: string;
  body: string;
}

export interface ParsedWebInspection {
  kind: 'inspection';
  assessment: QualityAssessment;
}

export type ParsedWebHandoff = ParsedWebDraft | ParsedWebInspection;

function stripMarkdownWrapper(text: string): string {
  return text
    .replace(/^```(?:json|markdown|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function buildWebHandoffGenerationPrompt(params: {
  basePrompt: string;
  asin: string;
  productTitle: string;
  productDescription: string;
  rating: number;
  liked: string;
  disliked: string;
  usage: string;
  notes: string;
  tone: string;
  length: string;
  recommend: string;
  learnedVoiceSummary?: string;
  learnedFacts?: string[];
  customInstructions?: string;
}): string {
  const fill = (v: string) => v.trim() || '—';
  const filledBase = params.basePrompt
    .replaceAll('{rating}', String(params.rating || 5))
    .replaceAll('{liked}', fill(params.liked))
    .replaceAll('{disliked}', fill(params.disliked))
    .replaceAll('{usage}', fill(params.usage))
    .replaceAll('{notes}', fill(params.notes))
    .replaceAll('{title}', fill(params.productTitle))
    .replaceAll('{asin}', fill(params.asin))
    .replaceAll('{description}', fill(params.productDescription));

  const voiceSection = params.learnedVoiceSummary
    ? `\n\nMy learned voice & context:\n${params.learnedVoiceSummary}${
        params.learnedFacts?.length
          ? `\n- ${params.learnedFacts.slice(0, 8).join('\n- ')}`
          : ''
      }`
    : '';

  const rulesSection = params.customInstructions?.trim()
    ? `\n\nVoice rules: ${params.customInstructions.trim()}`
    : '';

  return `${filledBase}
Target Tone: ${params.tone} | Target Length: ${params.length} | Recommend: ${params.recommend}${voiceSection}${rulesSection}

Output format (strictly either valid JSON {"title": "...", "body": "..."} OR exactly):
Headline: <concise headline>

<review body prose with zero em-dashes>`;
}

export function buildWebHandoffInspectionPrompt(params: {
  qualityPrompt: string;
  asin: string;
  productTitle: string;
  productDescription: string;
  rating: number;
  notes: string;
  draftTitle: string;
  draftBody: string;
}): string {
  return `${params.qualityPrompt}

ASIN: ${params.asin || 'UNKNOWN'}
Product Title: ${params.productTitle || 'N/A'}
Product Description: ${params.productDescription.slice(0, 2000) || 'N/A'}
Reviewer Rating: ${params.rating} / 5 stars
Reviewer Notes: ${params.notes || 'N/A'}
Draft Title: ${params.draftTitle}
Draft Body: ${params.draftBody}

Return ONLY valid JSON matching the schema.`;
}

export function parseWebHandoffResponse(rawInput: string): ParsedWebHandoff | null {
  const raw = stripMarkdownWrapper(String(rawInput || ''));
  if (!raw) return null;

  // 1. Try JSON extraction first (supports both draft JSON and quality inspection JSON)
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
      if (
        typeof parsed.band === 'string' &&
        (parsed.band === 'strong' || parsed.band === 'good' || parsed.band === 'needs_detail')
      ) {
        const matchObj = parsed.asinProductMatch as Record<string, unknown> | undefined;
        const origObj = parsed.originality as Record<string, unknown> | undefined;
        return {
          kind: 'inspection',
          assessment: {
            band: parsed.band,
            summary: deDash(String(parsed.summary || 'Web quality inspection imported.')).slice(0, 1900),
            asinProductMatch: {
              status:
                matchObj?.status === 'matched' ||
                matchObj?.status === 'mismatch' ||
                matchObj?.status === 'insufficient_metadata'
                  ? matchObj.status
                  : 'matched',
              reason: deDash(String(matchObj?.reason || 'Evaluated via web handoff.')).slice(0, 480),
            },
            originality: {
              verified: origObj?.verified !== false,
              reason: deDash(String(origObj?.reason || 'Evaluated via web handoff.')).slice(0, 480),
            },
            strengths: Array.isArray(parsed.strengths)
              ? parsed.strengths.map((s) => deDash(String(s)).slice(0, 480)).filter(Boolean).slice(0, 20)
              : [],
            suggestions: Array.isArray(parsed.suggestions)
              ? parsed.suggestions
                  .map((s) => {
                    const obj = (s || {}) as Record<string, unknown>;
                    return {
                      ...(obj.quote ? { quote: deDash(String(obj.quote)).slice(0, 480) } : {}),
                      issue: deDash(String(obj.issue || 'Review detail')).slice(0, 480),
                      question: deDash(String(obj.question || 'Add hands-on context')).slice(0, 480),
                    };
                  })
                  .slice(0, 20)
              : [],
            concerns: Array.isArray(parsed.concerns)
              ? parsed.concerns.map((c) => deDash(String(c)).slice(0, 480)).filter(Boolean).slice(0, 20)
              : [],
            providerUsed: 'web_handoff',
          },
        };
      }

      if (typeof parsed.title === 'string' || typeof parsed.headline === 'string') {
        const title = deDash(String(parsed.title || parsed.headline || '')).trim().slice(0, 200);
        const body = deDash(String(parsed.body || parsed.review || parsed.content || '')).trim();
        if (title || body) {
          return { kind: 'draft', title, body };
        }
      }
    } catch {
      // fall through to text parsing
    }
  }

  // 2. Labeled Headline / Title + Body format
  const labeledMatch = raw.match(
    /(?:^|\n)\s*(?:\*{0,2}(?:headline|title|review title|subject)\*{0,2})\s*[:\-–—]\s*(.+?)\s*\n+\s*(?:(?:\*{0,2}(?:body|review|review body|content)\*{0,2})\s*[:\-–—]\s*)?([\s\S]+)$/i
  );
  if (labeledMatch) {
    const title = deDash(labeledMatch[1].replace(/^["'*#]+|["'*]+$/g, '').trim()).slice(0, 200);
    const body = deDash(labeledMatch[2].trim());
    if (body) {
      return { kind: 'draft', title, body };
    }
  }

  // 3. Markdown heading (# Title or **Title**) followed by blank line + body
  const splitMatch = raw.match(/^\s*(.+?)\s*\n\s*\n([\s\S]+)$/);
  if (splitMatch) {
    const firstLine = splitMatch[1]
      .replace(/^#{1,6}\s*/, '')
      .replace(/^\*\*|\*\*$/g, '')
      .replace(/^(headline|title)\s*[:\-–—]\s*/i, '')
      .trim();
    const rest = splitMatch[2].trim();
    if (firstLine && rest && firstLine.length <= 200) {
      return {
        kind: 'draft',
        title: deDash(firstLine),
        body: deDash(rest),
      };
    }
  }

  // 4. Single block fallback: derive concise headline if needed
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0].length <= 160) {
    return {
      kind: 'draft',
      title: deDash(lines[0].replace(/^#{1,6}\s*|\*\*$/g, '').replace(/^\*\*/, '')),
      body: deDash(lines.slice(1).join('\n\n')),
    };
  }

  if (raw.length >= 20) {
    return {
      kind: 'draft',
      title: '',
      body: deDash(raw),
    };
  }

  return null;
}
