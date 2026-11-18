import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

export interface LiveFeedItem {
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

interface LiveFeedViewProps {
  marketplace: string;
  onSendToReview: (item: LiveFeedItem) => void;
}

export function LiveFeedView({ marketplace, onSendToReview }: LiveFeedViewProps) {
  const [items, setItems] = useState<LiveFeedItem[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamPaused, setStreamPaused] = useState(false);
  const [queueFilter, setQueueFilter] = useState<'ALL' | 'RFY' | 'AFA' | 'AI'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [zeroEtvOnly, setZeroEtvOnly] = useState(false);
  const [hideUnavailable, setHideUnavailable] = useState(true);

  const [feedSourceUrl, setFeedSourceUrl] = useState(() => {
    try {
      return localStorage.getItem('vc_live_feed_url') || '';
    } catch {
      return '';
    }
  });
  const [autoPollSeconds, setAutoPollSeconds] = useState<number>(0);
  const [polling, setPolling] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [feedNotice, setFeedNotice] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [pushDrawerOpen, setPushDrawerOpen] = useState(false);
  const [pushText, setPushText] = useState('');
  const [pushing, setPushing] = useState(false);

  const cleanHost = (marketplace || 'amazon.com')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  // Load feed immediately with zero authorization checkpoints + subscribe via SSE
  useEffect(() => {
    let cancelled = false;
    fetch('/api/feed/items')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.items)) {
          setItems(data.items);
          if (data.lastPolledAt) setLastPolledAt(data.lastPolledAt);
        }
      })
      .catch(() => {});

    if (streamPaused) {
      setStreamConnected(false);
      return;
    }

    const es = new EventSource('/api/feed/stream');
    es.onopen = () => setStreamConnected(true);
    es.onerror = () => setStreamConnected(false);
    es.addEventListener('init', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        if (Array.isArray(parsed?.items)) setItems(parsed.items);
        if (parsed?.lastPolledAt) setLastPolledAt(parsed.lastPolledAt);
      } catch {
        // ignore parse error
      }
    });
    es.addEventListener('drop', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data);
        if (Array.isArray(parsed?.items)) setItems(parsed.items);
        if (parsed?.lastPolledAt) setLastPolledAt(parsed.lastPolledAt);
      } catch {
        // ignore
      }
    });
    es.addEventListener('reset', () => {
      setItems([]);
    });

    return () => {
      cancelled = true;
      es.close();
      setStreamConnected(false);
    };
  }, [streamPaused]);

  const handlePollSource = useCallback(async () => {
    const trimmed = feedSourceUrl.trim();
    if (!trimmed) {
      setFeedError('Enter a non-Amazon community JSON or RSS feed URL to poll.');
      return;
    }
    try {
      const parsed = new URL(trimmed);
      if (/(^|\.)amazon\./i.test(parsed.hostname)) {
        setFeedError('Blocked: Live Feed strictly forbids querying or polling any Amazon domain.');
        return;
      }
    } catch {
      setFeedError('Enter a valid http(s) URL.');
      return;
    }

    try {
      localStorage.setItem('vc_live_feed_url', trimmed);
    } catch {
      // ignore storage failure
    }

    setPolling(true);
    setFeedError(null);
    setFeedNotice(null);
    try {
      const res = await fetch('/api/feed/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Feed poll failed.');
      if (Array.isArray(data?.items)) setItems(data.items);
      if (data?.lastPolledAt) setLastPolledAt(data.lastPolledAt);
      setFeedNotice(
        `Polled non-Amazon feed: ${Number(data?.parsed || 0)} item(s) parsed, ${Number(data?.added || 0)} new/updated.`
      );
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Feed poll failed.');
    } finally {
      setPolling(false);
    }
  }, [feedSourceUrl]);

  useEffect(() => {
    if (!autoPollSeconds || !feedSourceUrl.trim() || streamPaused) return;
    const timer = setInterval(() => {
      void handlePollSource();
    }, autoPollSeconds * 1000);
    return () => clearInterval(timer);
  }, [autoPollSeconds, feedSourceUrl, streamPaused, handlePollSource]);

  async function handlePushRaw() {
    if (!pushText.trim()) return;
    setPushing(true);
    setFeedError(null);
    setFeedNotice(null);
    try {
      const res = await fetch('/api/feed/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: pushText.trim(),
          sourceLabel: 'Manual / Relay Feed',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Push failed.');
      if (Array.isArray(data?.items)) setItems(data.items);
      setPushText('');
      setPushDrawerOpen(false);
      setFeedNotice(`Streamed ${Number(data?.added || 0)} drop item(s) to Live Feed.`);
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'Failed to push feed items.');
    } finally {
      setPushing(false);
    }
  }

  async function handleClearFeed() {
    setFeedError(null);
    await fetch('/api/feed/items', { method: 'DELETE' }).catch(() => {});
    setItems([]);
    setFeedNotice('Cleared local live feed buffer.');
  }

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (queueFilter !== 'ALL' && item.queue !== queueFilter) return false;
      if (hideUnavailable && item.unavailable) return false;
      if (zeroEtvOnly && item.etv !== 0) return false;
      if (q) {
        const hay = `${item.asin} ${item.title} ${item.category || ''} ${item.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, queueFilter, hideUnavailable, zeroEtvOnly, searchQuery]);

  const queueCounts = useMemo(
    () => ({
      ALL: items.length,
      RFY: items.filter((i) => i.queue === 'RFY').length,
      AFA: items.filter((i) => i.queue === 'AFA').length,
      AI: items.filter((i) => i.queue === 'AI').length,
    }),
    [items]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Live Feed
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-md border ${
                streamConnected
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Radio className="size-3" />
              {streamPaused ? 'Stream Paused' : streamConnected ? 'SSE Live' : 'Standby'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Zero-auth private drop stream via <span className="font-mono">/api/feed/stream</span> — never queries Amazon and never publishes your Amazon data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setStreamPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {streamPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {streamPaused ? 'Resume Stream' : 'Pause Stream'}
          </button>
          <button
            type="button"
            onClick={() => setPushDrawerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white whitespace-nowrap shrink-0"
          >
            <Plus className="size-3.5" />
            Push / Import Drops
          </button>
          <button
            type="button"
            onClick={handleClearFeed}
            disabled={items.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:border-rose-300 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Trash2 className="size-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Zero-Amazon Compliance Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200">
        <ShieldCheck className="size-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <strong>Zero Amazon Query Guarantee:</strong> All <span className="font-mono">/api/feed/*</span> routes block <span className="font-mono">amazon.*</span> hosts at the server layer and never transmit your reviews, ASIN history, or session details externally. Only use your separate review queue tools when syncing personal review tasks.
        </div>
      </div>

      {/* External Non-Amazon Community Feed Poller */}
      <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="url"
            value={feedSourceUrl}
            onChange={(e) => setFeedSourceUrl(e.target.value)}
            placeholder="Non-Amazon community JSON / RSS feed URL (e.g. https://your-community-relay.example/drops.json)…"
            className="flex-1 min-w-[240px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          />
          <select
            value={autoPollSeconds}
            onChange={(e) => setAutoPollSeconds(Number(e.target.value))}
            aria-label="Auto poll interval"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value={0}>Auto-Poll: Off</option>
            <option value={15}>Every 15s</option>
            <option value={30}>Every 30s</option>
            <option value={60}>Every 60s</option>
          </select>
          <button
            type="button"
            onClick={handlePollSource}
            disabled={polling || !feedSourceUrl.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`size-3.5 ${polling ? 'animate-spin' : ''}`} />
            {polling ? 'Polling…' : 'Poll Feed URL'}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            Webhook / Relay Push Endpoint:{' '}
            <code className="font-mono text-slate-700 dark:text-slate-300">
              POST {typeof window !== 'undefined' ? window.location.origin : ''}/api/feed/push
            </code>
          </span>
          {lastPolledAt && (
            <span>Last polled: {new Date(lastPolledAt).toLocaleTimeString()}</span>
          )}
        </div>
      </section>

      {pushDrawerOpen && (
        <section className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Push Drops Into Live Feed (JSON array, RSS XML, or ASIN | Title | RFY/AFA/AI | ETV lines)
          </div>
          <textarea
            value={pushText}
            onChange={(e) => setPushText(e.target.value)}
            rows={4}
            placeholder={'B0C1234567 | Silicone Espresso Mat | AFA | $0.00\n[{"asin":"B0D9876543","title":"USB-C Mechanical Keypad","queue":"RFY","etv":24.99}]'}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPushDrawerOpen(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePushRaw}
              disabled={pushing || !pushText.trim()}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pushing ? 'Pushing…' : 'Broadcast to Live Feed'}
            </button>
          </div>
        </section>
      )}

      {feedError && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
          {feedError}
        </div>
      )}
      {feedNotice && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          {feedNotice}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
          {(['ALL', 'RFY', 'AFA', 'AI'] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setQueueFilter(tier)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                queueFilter === tier
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tier} ({queueCounts[tier]})
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="relative">
            <Search className="size-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter ASIN, title, category…"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={zeroEtvOnly}
              onChange={(e) => setZeroEtvOnly(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            $0 ETV Only
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={hideUnavailable}
              onChange={(e) => setHideUnavailable(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Hide Unavailable
          </label>
        </div>
      </div>

      {/* Feed Cards */}
      {filteredItems.length === 0 ? (
        <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-10 text-center space-y-2 bg-white dark:bg-slate-900">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
            No live feed drops matched yet
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
            Connect a non-Amazon community JSON/RSS feed URL above, stream drops into{' '}
            <span className="font-mono">POST /api/feed/push</span>, or click{' '}
            <strong>Push / Import Drops</strong> to add items directly. Zero authorization checkpoints and zero Amazon queries.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {item.asin}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-semibold ${
                        item.queue === 'RFY'
                          ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300'
                          : item.queue === 'AFA'
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                            : 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                      }`}
                    >
                      {item.queue}
                    </span>
                    {item.etv !== null && item.etv !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium tabular-nums ${
                          item.etv === 0
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        ${Number(item.etv).toFixed(2)} ETV
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400">
                    {new Date(item.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2">
                  {item.title}
                </h3>

                {item.description && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  {item.category && <span>{item.category}</span>}
                  {item.sourceLabel && <span>· {item.sourceLabel}</span>}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onSendToReview(item)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white whitespace-nowrap shrink-0"
                >
                  Load Into Review Editor
                </button>
                <a
                  href={`https://www.${cleanHost}/dp/${encodeURIComponent(item.asin)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Open Listing
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
