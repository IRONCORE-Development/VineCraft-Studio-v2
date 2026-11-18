export type QualityBand = 'none' | 'needs_detail' | 'good' | 'strong';
export type ReviewStatus =
  | 'queued'
  | 'needs_review'
  | 'interaction_required'
  | 'cached_strong'
  | 'ready_to_post'
  | 'posted'
  | 'submitted'
  | 'completed';
export type ReviewTone = 'balanced' | 'enthusiastic' | 'critical' | 'concise';
export type ReviewLength = 'short' | 'medium' | 'long';
export type RecommendChoice = 'yes' | 'no' | 'unset';
export type StrongActionMode = 'cache_and_next' | 'direct_post';
export type AiEnginePreset =
  | 'free_local'
  | 'anthropic'
  | 'gemini'
  | 'custom_endpoint'
  | 'custom_gemini'
  | 'custom_anthropic'
  | 'custom_openrouter'
  | 'web_handoff';
export type WebHandoffTarget = 'claude' | 'duck' | 'qwen' | 'mistral' | 'chatgpt' | 'gemini';
export type ReviewSource =
  | 'manual'
  | 'amazon_detection'
  | 'amazon_pagination'
  | 'html_import'
  | 'batch_import';

export interface QualitySuggestion {
  quote?: string;
  issue: string;
  question: string;
}

export interface AsinProductMatchCheck {
  status: 'matched' | 'mismatch' | 'insufficient_metadata';
  reason: string;
}

export interface OriginalityCheck {
  verified: boolean;
  reason: string;
}

export interface QualityAssessment {
  band: Exclude<QualityBand, 'none'>;
  summary: string;
  asinProductMatch?: AsinProductMatchCheck;
  originality?: OriginalityCheck;
  strengths: string[];
  suggestions: QualitySuggestion[];
  concerns: string[];
  usage?: TokenUsage;
  providerUsed?: string;
}

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UserProfile {
  uid: string;
  displayName?: string;
  email?: string;
  autoInspectOnGenerate: boolean;
  strongActionMode: StrongActionMode;
  justClickSubmitEnabled: boolean;
  autoRefineBelowStrong: boolean;
  defaultTone: ReviewTone;
  defaultLength: ReviewLength;
  customInstructions?: string;
  amazonMarketplace: string;
  maxBatchItems?: number;
  maxBatchTokens?: number;
  batchDelayMs?: number;
  aiEnginePreset?: AiEnginePreset;
  webHandoffTarget?: WebHandoffTarget;
  allowLocalCompute?: boolean;
  privateSessionPerGeneration?: boolean;
  advancedOverrideEnabled?: boolean;
  generationModel?: string;
  qualityModel?: string;
  customEndpointUrl?: string;
  qualitySystemPromptOverride?: string;
  learnedToneEnabled?: boolean;
  learnedToneSummary?: string;
  learnedFacts?: string[];
  learnedReviewsUsed?: number;
  learnedToneOverrideEnabled?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReviewItem {
  id: string;
  ownerId: string;
  asin: string;
  productTitle: string;
  productDescription?: string;
  productImage?: string;
  reviewUrl?: string;
  reviewLink?: string;
  unavailableReason?: string;
  amazonStatusText?: string;
  amazonQualityText?: string;
  orderDateText?: string;
  marketplace: string;
  rating: number;
  liked?: string;
  disliked?: string;
  usage?: string;
  notes?: string;
  recommend: RecommendChoice;
  tone: ReviewTone;
  length: ReviewLength;
  draftTitle?: string;
  draftBody?: string;
  qualityBand: QualityBand;
  qualitySummary?: string;
  qualityAsinMatch?: AsinProductMatchCheck;
  qualityOriginality?: OriginalityCheck;
  qualityStrengths?: string[];
  qualitySuggestions?: QualitySuggestion[];
  qualityConcerns?: string[];
  tokensUsed?: number;
  status: ReviewStatus;
  batchId?: string;
  source: ReviewSource;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StagedPhoto {
  id: string;
  name: string;
  mime: string;
  data: string; // base64 without data: prefix
  previewUrl: string;
  width: number;
  height: number;
}
