import { useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Search, Send } from 'lucide-react';
import { ReviewItem } from '../types';

interface CachedStrongViewProps {
  items: ReviewItem[];
  onPostToAmazon: (item: ReviewItem) => Promise<void>;
  onSyncToPopup?: (item: ReviewItem) => Promise<void>;
  onMarkPosted: (item: ReviewItem) => Promise<void>;
  onOpenInEditor: (item: ReviewItem) => void;
}

export function CachedStrongView({
  items,
  onPostToAmazon,
  onSyncToPopup,
  onMarkPosted,
  onOpenInEditor,
}: CachedStrongViewProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all_cached' | 'cached_strong' | 'ready_to_post' | 'posted'>('all_cached');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const cachedItems = useMemo(() => {
    const base = items.filter((item) => {
      if (filter === 'all_cached') {
        return (
          item.qualityBand === 'strong' ||
          item.status === 'cached_strong' ||
          item.status === 'ready_to_post' ||
          item.status === 'posted'
        );
      }
      return item.status === filter;
    });
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((i) =>
      `${i.asin} ${i.productTitle} ${i.draftTitle || ''} ${i.draftBody || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [items, filter, search]);

  async function copyDraft(item: ReviewItem) {
    const text = `${item.draftTitle || ''}\n\n${item.draftBody || ''}`.trim();
    await navigator.clipboard.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 1500);
  }

  function exportJson() {
    const payload = cachedItems.map((i) => ({
      asin: i.asin,
      productTitle: i.productTitle,
      rating: i.rating,
      headline: i.draftTitle,
      body: i.draftBody,
      qualityBand: i.qualityBand,
      status: i.status,
      reviewUrl: i.reviewUrl,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vinecraft-strong-cache-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Strong Review Database Cache
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Reviews graded “Strong” by AI Quality Inspection are cached here automatically for safe clipboard copy and manual Amazon submission.
          </p>
        </div>

        <button
          type="button"
          onClick={exportJson}
          disabled={cachedItems.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="size-3.5" />
          Export JSON
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {(
            [
              ['all_cached', 'All Strong & Posted'],
              ['cached_strong', 'Cached Strong'],
              ['ready_to_post', 'Ready to Post'],
              ['posted', 'Posted'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filter === key
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by ASIN, title, or text…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {cachedItems.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-10 text-center space-y-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            No cached Strong reviews match this view yet
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Generate reviews in the Workspace or Batch Queue—anything graded “Strong” automatically saves here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {cachedItems.map((item) => (
            <article
              key={item.id}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {item.asin}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{item.rating}/5 stars</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                      {item.qualityBand === 'strong' ? 'Strong' : item.qualityBand}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {item.status === 'posted'
                        ? 'Posted to Amazon'
                        : item.status === 'ready_to_post'
                          ? 'Ready to Post'
                          : 'Cached in DB'}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {item.draftTitle || item.productTitle}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    Product: {item.productTitle}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyDraft(item)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {copiedId === item.id ? (
                      <>
                        <Check className="size-3.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenInEditor(item)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    Edit
                  </button>
                  {item.status !== 'posted' && (
                    <>
                      {onSyncToPopup && (
                        <button
                          type="button"
                          onClick={() => onSyncToPopup(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 whitespace-nowrap shrink-0"
                        >
                          Sync to Popup
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onPostToAmazon(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                      >
                        <Send className="size-3.5" />
                        Copy & Open Amazon
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarkPosted(item)}
                        title="Mark as posted after submitting on Amazon"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 whitespace-nowrap shrink-0"
                      >
                        <ExternalLink className="size-3.5" />
                        Mark Posted
                      </button>
                    </>
                  )}
                </div>
              </div>

              {item.draftBody && (
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line line-clamp-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {item.draftBody}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
