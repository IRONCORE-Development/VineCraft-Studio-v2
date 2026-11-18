/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RecommendChoice, ReviewLength, ReviewStatus, ReviewTone, ReviewSource } from '../types';

export interface CreateReviewInput {
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
  marketplace?: string;
  rating?: number;
  liked?: string;
  disliked?: string;
  usage?: string;
  notes?: string;
  recommend?: RecommendChoice;
  tone?: ReviewTone;
  length?: ReviewLength;
  status?: ReviewStatus;
  source?: ReviewSource;
}

export function normalizeAsin(raw: string): string {
  const clean = String(raw || '').trim().toUpperCase();
  const dpMatch = clean.match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/i);
  if (dpMatch) return dpMatch[1].toUpperCase();
  const asinParam = clean.match(/[?&]ASIN=([A-Z0-9]{8,14})/i);
  if (asinParam) return asinParam[1].toUpperCase();
  const tokenMatch = clean.match(/\b([A-Z0-9]{10})\b/);
  if (tokenMatch) return tokenMatch[1].toUpperCase();
  return clean.replace(/[^A-Z0-9]/g, '').slice(0, 14);
}

function decodeHtmlEntities(str: string): string {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html: string): string {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ' '));
}

export function parseBatchTextInput(raw: string, marketplace = 'amazon.com'): CreateReviewInput[] {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];

  const results: CreateReviewInput[] = [];
  const seen = new Set<string>();

  try {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const asin = normalizeAsin(String(rec.asin || rec.ASIN || ''));
      if (!/^[A-Z0-9]{8,14}$/.test(asin) || seen.has(asin)) continue;
      seen.add(asin);
      results.push({
        asin,
        productTitle: String(rec.productTitle || rec.title || `Amazon Item ${asin}`).trim().slice(0, 500),
        productDescription: rec.productDescription || rec.description ? String(rec.productDescription || rec.description).slice(0, 5000) : undefined,
        productImage: rec.productImage || rec.image ? String(rec.productImage || rec.image).slice(0, 1000) : undefined,
        reviewUrl: rec.reviewUrl ? String(rec.reviewUrl).slice(0, 1000) : undefined,
        marketplace: String(rec.marketplace || marketplace).slice(0, 64),
        rating: Math.round(Math.min(5, Math.max(0, Number(rec.rating ?? 5)))),
        liked: rec.liked ? String(rec.liked).slice(0, 2000) : undefined,
        disliked: rec.disliked ? String(rec.disliked).slice(0, 2000) : undefined,
        usage: rec.usage ? String(rec.usage).slice(0, 2000) : undefined,
        notes: rec.notes || rec.note ? String(rec.notes || rec.note).slice(0, 4000) : undefined,
        recommend: 'yes',
        tone: 'balanced',
        length: 'medium',
        status: 'queued',
        source: 'batch_import',
      });
    }
    if (results.length > 0) return results;
  } catch {
    // Not JSON; fall through to delimited/line parser
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip CSV header rows
    if (/^asin\s*[,|\t]/i.test(line)) continue;
    const parts = line.split(/[\|\t,]/).map((p) => p.trim());
    const firstAsin = normalizeAsin(parts[0] || '');
    if (/^[A-Z0-9]{8,14}$/.test(firstAsin) && !seen.has(firstAsin)) {
      seen.add(firstAsin);
      results.push({
        asin: firstAsin,
        productTitle: (parts[1] || `Amazon Item ${firstAsin}`).slice(0, 500),
        marketplace: marketplace.slice(0, 64),
        rating: 5,
        notes: parts.slice(2).join(', ').slice(0, 4000) || undefined,
        recommend: 'yes',
        tone: 'balanced',
        length: 'medium',
        status: 'queued',
        source: 'batch_import',
      });
      continue;
    }

    const inlineAsin = line.match(/\b([A-Z0-9]{10})\b/);
    if (inlineAsin) {
      const asin = inlineAsin[1].toUpperCase();
      if (!seen.has(asin)) {
        seen.add(asin);
        const title = line
          .replace(inlineAsin[0], '')
          .replace(/^[\s\-|,]+|[\s\-|,]+$/g, '')
          .trim();
        results.push({
          asin,
          productTitle: (title || `Amazon Item ${asin}`).slice(0, 500),
          marketplace: marketplace.slice(0, 64),
          rating: 5,
          recommend: 'yes',
          tone: 'balanced',
          length: 'medium',
          status: 'queued',
          source: 'batch_import',
        });
      }
    }
  }

  return results;
}

export function parseAmazonVineHtml(html: string, marketplace = 'amazon.com'): CreateReviewInput[] {
  const results: CreateReviewInput[] = [];
  if (!html || typeof html !== 'string') return results;

  const seenAsins = new Set<string>();
  const cleanHost = marketplace.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'amazon.com';

  // Split by Vine review table rows or item tiles if present
  const rowChunks = html.split(/(?=<tr[^>]*class="[^"]*vvp-reviews-table--row|<div[^>]*class="[^"]*vvp-item-tile)/i);
  const chunks = rowChunks.length > 1 ? rowChunks : [html];

  for (const chunk of chunks) {
    const asinMatches = [
      ...chunk.matchAll(/(?:data-asin=["']([A-Z0-9]{10})["']|\/dp\/([A-Z0-9]{10})|[?&]asin=([A-Z0-9]{10}))/gi),
    ];
    if (!asinMatches.length) continue;

    for (const m of asinMatches) {
      const asin = normalizeAsin(m[1] || m[2] || m[3] || '');
      if (!/^[A-Z0-9]{8,14}$/.test(asin) || seenAsins.has(asin)) continue;
      seenAsins.add(asin);

      // Extract product title from truncate spans, alt attributes, or anchor text
      let productTitle = '';
      const truncateMatch = chunk.match(/class="[^"]*a-truncate-full[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      if (truncateMatch) productTitle = stripTags(truncateMatch[1]);
      if (!productTitle) {
        const dpLinkMatch = chunk.match(new RegExp(`<a[^>]+href="[^"]*/dp/${asin}[^"]*"[^>]*>([\\s\\S]*?)</a>`, 'i'));
        if (dpLinkMatch) productTitle = stripTags(dpLinkMatch[1]);
      }
      if (!productTitle) {
        const imgAltMatch = chunk.match(/<img[^>]+alt="([^"]{4,300})"/i);
        if (imgAltMatch) productTitle = decodeHtmlEntities(imgAltMatch[1]);
      }
      if (!productTitle) productTitle = `Amazon Vine Item ${asin}`;

      // Extract image URL
      const imgMatch = chunk.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);
      const productImage = imgMatch ? imgMatch[1].slice(0, 1000) : undefined;

      // Extract review URL
      const reviewHrefMatch = chunk.match(new RegExp(`href="([^"]*review/create-review[^"]*${asin}[^"]*)"`, 'i'));
      let reviewUrl: string | undefined;
      if (reviewHrefMatch) {
        const rawHref = decodeHtmlEntities(reviewHrefMatch[1]);
        reviewUrl = rawHref.startsWith('http')
          ? rawHref.slice(0, 1000)
          : `https://www.${cleanHost}${rawHref.startsWith('/') ? '' : '/'}${rawHref}`.slice(0, 1000);
      }

      // Extract status / unavailable cues
      const textOnly = stripTags(chunk);
      let status: ReviewStatus = 'queued';
      let unavailableReason: string | undefined;
      let amazonStatusText: string | undefined;

      if (/not yet reviewed|review item/i.test(textOnly)) {
        status = 'queued';
        amazonStatusText = 'Not yet reviewed';
      }
      if (/pending approval/i.test(textOnly)) {
        status = 'submitted';
        amazonStatusText = 'Pending approval';
      } else if (/\bapproved\b/i.test(textOnly) && !/not approved/i.test(textOnly)) {
        status = 'completed';
        amazonStatusText = 'Approved';
      } else if (/not approved|rejected|unavailable|no longer available/i.test(textOnly)) {
        status = 'interaction_required';
        unavailableReason = /no longer available/i.test(textOnly)
          ? 'This item is no longer available'
          : 'Requires user interaction on Amazon Vine';
        amazonStatusText = 'Interaction required';
      }

      const dateMatch = textOnly.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i);

      results.push({
        asin,
        productTitle: productTitle.slice(0, 500),
        productImage,
        reviewUrl,
        unavailableReason,
        amazonStatusText,
        orderDateText: dateMatch ? dateMatch[0].slice(0, 100) : undefined,
        marketplace: cleanHost.slice(0, 64),
        rating: 5,
        recommend: 'yes',
        tone: 'balanced',
        length: 'medium',
        status,
        source: 'html_import',
      });
    }
  }

  return results;
}
