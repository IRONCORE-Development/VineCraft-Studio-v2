/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType } from './firestoreErrors';
import {
  QualityAssessment,
  QualityBand,
  RecommendChoice,
  ReviewItem,
  ReviewLength,
  ReviewStatus,
  ReviewTone,
  StagedPhoto,
  UserProfile,
} from '../types';
import { CreateReviewInput, normalizeAsin } from './batchReviewParser';

export { normalizeAsin, parseBatchTextInput, parseAmazonVineHtml } from './batchReviewParser';
export type { CreateReviewInput } from './batchReviewParser';

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function clampStr(val: unknown, maxLen: number): string {
  return String(val ?? '').trim().slice(0, maxLen);
}

function optStr(val: unknown, maxLen: number): string | undefined {
  if (val === undefined || val === null) return undefined;
  const s = String(val).trim();
  return s ? s.slice(0, maxLen) : undefined;
}

export async function downscaleFileToJpeg(file: File): Promise<StagedPhoto> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const base64 = dataUrl.split(',')[1] || '';
        resolve({
          id: `pho_${Math.random().toString(36).slice(2, 9)}`,
          name: file.name.replace(/\.[^/.]+$/, '') + '.jpg',
          mime: 'image/jpeg',
          data: base64,
          previewUrl: dataUrl,
          width,
          height,
        });
      };
      img.onerror = () => reject(new Error('Failed to load image file'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function ensureUserProfile(
  uid: string,
  email?: string | null,
  displayName?: string | null
): Promise<UserProfile> {
  const ref = doc(db, 'users', uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }

    const defaultProfile: UserProfile = {
      uid,
      displayName: clampStr(displayName || email?.split('@')[0] || 'Vine Reviewer', 120),
      email: clampStr(email || '', 200),
      autoInspectOnGenerate: true,
      strongActionMode: 'cache_and_next',
      justClickSubmitEnabled: true,
      autoRefineBelowStrong: true,
      defaultTone: 'balanced',
      defaultLength: 'medium',
      amazonMarketplace: 'amazon.com',
      maxBatchItems: 25,
      maxBatchTokens: 150000,
      batchDelayMs: 2000,
      aiEnginePreset: 'anthropic',
      webHandoffTarget: 'duck',
      allowLocalCompute: false,
      privateSessionPerGeneration: true,
      advancedOverrideEnabled: false,
      generationModel: 'claude-3-5-sonnet-latest',
      qualityModel: 'claude-3-5-haiku-latest',
      learnedToneEnabled: true,
      learnedToneSummary: '',
      learnedFacts: [],
      learnedReviewsUsed: 0,
      learnedToneOverrideEnabled: false,
    };

    await setDoc(
      ref,
      stripUndefined({
        ...defaultProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    return defaultProfile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
}

export function subscribeUserProfile(uid: string, callback: (profile: UserProfile) => void): () => void {
  const ref = doc(db, 'users', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as UserProfile);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    }
  );
}

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'object') {
    const obj = ts as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
    if (typeof obj._seconds === 'number') return obj._seconds * 1000;
  }
  return 0;
}

export function subscribeUserReviews(uid: string, callback: (reviews: ReviewItem[]) => void): () => void {
  const q = query(collection(db, 'users', uid, 'reviews'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as ReviewItem))
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      callback(list);
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/reviews`);
    }
  );
}

export async function updateUserProfile(uid: string, patch: Partial<UserProfile>): Promise<void> {
  const ref = doc(db, 'users', uid);
  const sanitized = stripUndefined({
    displayName: patch.displayName !== undefined ? clampStr(patch.displayName, 120) : undefined,
    email: patch.email !== undefined ? clampStr(patch.email, 200) : undefined,
    autoInspectOnGenerate: patch.autoInspectOnGenerate,
    strongActionMode: patch.strongActionMode,
    justClickSubmitEnabled: patch.justClickSubmitEnabled,
    autoRefineBelowStrong: patch.autoRefineBelowStrong,
    defaultTone: patch.defaultTone,
    defaultLength: patch.defaultLength,
    customInstructions:
      patch.customInstructions !== undefined ? clampStr(patch.customInstructions, 4000) : undefined,
    amazonMarketplace:
      patch.amazonMarketplace !== undefined ? clampStr(patch.amazonMarketplace, 64) : undefined,
    maxBatchItems:
      patch.maxBatchItems !== undefined
        ? Math.round(Math.min(500, Math.max(1, Number(patch.maxBatchItems))))
        : undefined,
    maxBatchTokens:
      patch.maxBatchTokens !== undefined
        ? Math.round(Math.min(5000000, Math.max(5000, Number(patch.maxBatchTokens))))
        : undefined,
    batchDelayMs:
      patch.batchDelayMs !== undefined
        ? Math.round(Math.min(60000, Math.max(0, Number(patch.batchDelayMs))))
        : undefined,
    aiEnginePreset: patch.aiEnginePreset,
    webHandoffTarget: patch.webHandoffTarget,
    allowLocalCompute: patch.allowLocalCompute,
    privateSessionPerGeneration: patch.privateSessionPerGeneration,
    advancedOverrideEnabled: patch.advancedOverrideEnabled,
    generationModel:
      patch.generationModel !== undefined ? clampStr(patch.generationModel, 120) : undefined,
    qualityModel:
      patch.qualityModel !== undefined ? clampStr(patch.qualityModel, 120) : undefined,
    customEndpointUrl:
      patch.customEndpointUrl !== undefined ? clampStr(patch.customEndpointUrl, 500) : undefined,
    qualitySystemPromptOverride:
      patch.qualitySystemPromptOverride !== undefined
        ? clampStr(patch.qualitySystemPromptOverride, 6000)
        : undefined,
    learnedToneEnabled: patch.learnedToneEnabled,
    learnedToneSummary:
      patch.learnedToneSummary !== undefined ? clampStr(patch.learnedToneSummary, 3000) : undefined,
    learnedFacts:
      patch.learnedFacts !== undefined
        ? patch.learnedFacts.map((f) => clampStr(f, 500)).filter(Boolean).slice(0, 30)
        : undefined,
    learnedReviewsUsed:
      patch.learnedReviewsUsed !== undefined
        ? Math.round(Math.min(10000, Math.max(0, Number(patch.learnedReviewsUsed))))
        : undefined,
    learnedToneOverrideEnabled: patch.learnedToneOverrideEnabled,
    updatedAt: serverTimestamp(),
  });

  try {
    await updateDoc(ref, sanitized);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function createReviewItem(uid: string, input: CreateReviewInput): Promise<string> {
  const cleanAsin = normalizeAsin(input.asin);
  const reviewId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ref = doc(db, 'users', uid, 'reviews', reviewId);

  const payload = stripUndefined({
    ownerId: uid,
    asin: cleanAsin,
    productTitle: clampStr(input.productTitle || `Amazon Item ${cleanAsin}`, 500) || `Amazon Item ${cleanAsin}`,
    productDescription: optStr(input.productDescription, 5000),
    productImage: optStr(input.productImage, 1000),
    reviewUrl: optStr(input.reviewUrl, 1000),
    reviewLink: optStr(input.reviewLink, 1000),
    unavailableReason: optStr(input.unavailableReason, 500),
    amazonStatusText: optStr(input.amazonStatusText, 200),
    amazonQualityText: optStr(input.amazonQualityText, 200),
    orderDateText: optStr(input.orderDateText, 100),
    marketplace: clampStr(input.marketplace || 'amazon.com', 64) || 'amazon.com',
    rating: Math.round(Math.min(5, Math.max(0, Number(input.rating ?? 5)))),
    liked: optStr(input.liked, 2000),
    disliked: optStr(input.disliked, 2000),
    usage: optStr(input.usage, 2000),
    notes: optStr(input.notes, 4000),
    recommend: input.recommend || 'yes',
    tone: input.tone || 'balanced',
    length: input.length || 'medium',
    qualityBand: 'none',
    status: input.status || 'queued',
    source: input.source || 'manual',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(ref, payload);
    return reviewId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/reviews/${reviewId}`);
  }
}

export async function createReviewBatch(
  uid: string,
  inputs: CreateReviewInput[],
  marketplace: string,
  defaultTone: ReviewTone,
  defaultLength: ReviewLength,
  existingReviews: ReviewItem[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const item of inputs) {
    const cleanAsin = normalizeAsin(item.asin);
    if (!/^[A-Z0-9]{8,14}$/.test(cleanAsin)) continue;

    const existing = existingReviews.find((r) => r.asin === cleanAsin && r.status !== 'completed');
    if (existing) {
      const ref = doc(db, 'users', uid, 'reviews', existing.id);
      // Strictly match Action 3 affectedKeys allowlist in firestore.rules
      const action3Patch = stripUndefined({
        status: item.status || existing.status,
        productTitle: clampStr(item.productTitle || existing.productTitle, 500) || existing.productTitle,
        productImage: optStr(item.productImage || existing.productImage, 1000),
        reviewUrl: optStr(item.reviewUrl || existing.reviewUrl, 1000),
        reviewLink: optStr(item.reviewLink || existing.reviewLink, 1000),
        unavailableReason: optStr(item.unavailableReason || existing.unavailableReason, 500),
        amazonStatusText: optStr(item.amazonStatusText || existing.amazonStatusText, 200),
        amazonQualityText: optStr(item.amazonQualityText || existing.amazonQualityText, 200),
        orderDateText: optStr(item.orderDateText || existing.orderDateText, 100),
        updatedAt: serverTimestamp(),
      });
      try {
        await updateDoc(ref, action3Patch);
        updated++;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/reviews/${existing.id}`);
      }
    } else {
      await createReviewItem(uid, {
        ...item,
        asin: cleanAsin,
        marketplace: item.marketplace || marketplace,
        tone: item.tone || defaultTone,
        length: item.length || defaultLength,
      });
      created++;
    }
  }

  return { created, updated };
}

export async function updateReviewExperience(
  uid: string,
  reviewId: string,
  patch: {
    productTitle: string;
    productDescription?: string;
    reviewUrl?: string;
    marketplace: string;
    rating: number;
    liked: string;
    disliked: string;
    usage: string;
    notes: string;
    recommend: RecommendChoice;
    tone: ReviewTone;
    length: ReviewLength;
  }
): Promise<void> {
  const ref = doc(db, 'users', uid, 'reviews', reviewId);
  // Strictly match Action 1 affectedKeys allowlist in firestore.rules
  const action1Patch = stripUndefined({
    productTitle: clampStr(patch.productTitle, 500) || 'Amazon Item',
    productDescription: clampStr(patch.productDescription || '', 5000),
    reviewUrl: clampStr(patch.reviewUrl || '', 1000),
    marketplace: clampStr(patch.marketplace || 'amazon.com', 64) || 'amazon.com',
    rating: Math.round(Math.min(5, Math.max(0, Number(patch.rating ?? 5)))),
    liked: clampStr(patch.liked || '', 2000),
    disliked: clampStr(patch.disliked || '', 2000),
    usage: clampStr(patch.usage || '', 2000),
    notes: clampStr(patch.notes || '', 4000),
    recommend: patch.recommend || 'yes',
    tone: patch.tone || 'balanced',
    length: patch.length || 'medium',
    updatedAt: serverTimestamp(),
  });

  try {
    await updateDoc(ref, action1Patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/reviews/${reviewId}`);
  }
}

export async function saveDraftAndQuality(
  uid: string,
  reviewId: string,
  data: {
    draftTitle: string;
    draftBody: string;
    rating: number;
    qualityBand: QualityBand;
    assessment?: QualityAssessment | null;
    tokensUsed?: number;
    status: ReviewStatus;
  }
): Promise<void> {
  const ref = doc(db, 'users', uid, 'reviews', reviewId);
  // Strictly match Action 2 affectedKeys allowlist in firestore.rules
  const payload: Record<string, unknown> = {
    draftTitle: clampStr(data.draftTitle, 500),
    draftBody: clampStr(data.draftBody, 20000),
    rating: Math.round(Math.min(5, Math.max(0, Number(data.rating ?? 5)))),
    qualityBand: data.qualityBand || 'none',
    status: data.status,
    updatedAt: serverTimestamp(),
  };

  if (data.tokensUsed !== undefined) {
    payload.tokensUsed = Math.round(Math.min(1000000, Math.max(0, Number(data.tokensUsed || 0))));
  }

  if (data.assessment) {
    payload.qualitySummary = clampStr(data.assessment.summary || '', 2000);
    if (data.assessment.asinProductMatch) {
      payload.qualityAsinMatch = {
        status: data.assessment.asinProductMatch.status,
        reason: clampStr(data.assessment.asinProductMatch.reason || '', 500),
      };
    }
    if (data.assessment.originality) {
      payload.qualityOriginality = {
        verified: Boolean(data.assessment.originality.verified),
        reason: clampStr(data.assessment.originality.reason || '', 500),
      };
    }
    payload.qualityStrengths = (data.assessment.strengths || [])
      .map((s) => clampStr(s, 500))
      .filter(Boolean)
      .slice(0, 20);
    payload.qualitySuggestions = (data.assessment.suggestions || [])
      .map((s) =>
        stripUndefined({
          quote: s.quote ? clampStr(s.quote, 500) : undefined,
          issue: clampStr(s.issue || 'Review detail', 500),
          question: clampStr(s.question || 'What specific detail did you observe?', 500),
        })
      )
      .slice(0, 20);
    payload.qualityConcerns = (data.assessment.concerns || [])
      .map((c) => clampStr(c, 500))
      .filter(Boolean)
      .slice(0, 20);
  }

  try {
    await updateDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/reviews/${reviewId}`);
  }
}

export async function transitionReviewStatus(uid: string, reviewId: string, status: ReviewStatus): Promise<void> {
  const ref = doc(db, 'users', uid, 'reviews', reviewId);
  try {
    await updateDoc(ref, {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/reviews/${reviewId}`);
  }
}

export async function deleteReviewItem(uid: string, reviewId: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'reviews', reviewId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}/reviews/${reviewId}`);
  }
}
