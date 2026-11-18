import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Lock,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { AiEnginePreset, ReviewItem, WebHandoffTarget } from '../types';

interface AdvancedAiModalProps {
  open: boolean;
  onClose: () => void;
  lockedQualityPrompt: string;
  aiEnginePreset: AiEnginePreset;
  webHandoffTarget: WebHandoffTarget;
  allowLocalCompute: boolean;
  privateSessionPerGeneration: boolean;
  advancedOverrideEnabled: boolean;
  generationModel: string;
  qualityModel: string;
  customEndpointUrl: string;
  qualitySystemPromptOverride: string;
  learnedToneEnabled: boolean;
  learnedToneSummary: string;
  learnedFacts: string[];
  learnedReviewsUsed: number;
  learnedToneOverrideEnabled: boolean;
  reviews: ReviewItem[];
  serverProviders: {
    free_local: boolean;
    anthropic: boolean;
    gemini: boolean;
    custom_endpoint: boolean;
    custom_gemini?: boolean;
    custom_anthropic?: boolean;
    custom_openrouter?: boolean;
  };
  onSave: (patch: {
    aiEnginePreset: AiEnginePreset;
    webHandoffTarget: WebHandoffTarget;
    allowLocalCompute: boolean;
    privateSessionPerGeneration: boolean;
    advancedOverrideEnabled: boolean;
    generationModel: string;
    qualityModel: string;
    customEndpointUrl: string;
    qualitySystemPromptOverride: string;
    learnedToneEnabled: boolean;
    learnedToneSummary: string;
    learnedFacts: string[];
    learnedReviewsUsed: number;
    learnedToneOverrideEnabled: boolean;
  }) => Promise<void>;
}

export function AdvancedAiModal({
  open,
  onClose,
  lockedQualityPrompt,
  aiEnginePreset,
  webHandoffTarget,
  allowLocalCompute,
  privateSessionPerGeneration,
  advancedOverrideEnabled,
  generationModel,
  qualityModel,
  customEndpointUrl,
  qualitySystemPromptOverride,
  learnedToneEnabled,
  learnedToneSummary,
  learnedFacts,
  learnedReviewsUsed,
  learnedToneOverrideEnabled,
  reviews,
  serverProviders,
  onSave,
}: AdvancedAiModalProps) {
  const [preset, setPreset] = useState<AiEnginePreset>(aiEnginePreset);
  const [handoffTarget, setHandoffTarget] = useState<WebHandoffTarget>(webHandoffTarget);
  const [localAllowed, setLocalAllowed] = useState(allowLocalCompute);
  const [privateSession, setPrivateSession] = useState(privateSessionPerGeneration);
  const [unlocked, setUnlocked] = useState(advancedOverrideEnabled);
  const [genModel, setGenModel] = useState(generationModel);
  const [qualModel, setQualModel] = useState(qualityModel);
  const [endpoint, setEndpoint] = useState(customEndpointUrl);
  const [qualPrompt, setQualPrompt] = useState(
    qualitySystemPromptOverride || lockedQualityPrompt
  );

  // Learned Tone & Reviewer Persona state
  const [toneOn, setToneOn] = useState(learnedToneEnabled);
  const [toneSummary, setToneSummary] = useState(learnedToneSummary);
  const [facts, setFacts] = useState<string[]>(learnedFacts);
  const [reviewsUsed, setReviewsUsed] = useState(learnedReviewsUsed);
  const [toneUnlocked, setToneUnlocked] = useState(learnedToneOverrideEnabled);
  const [pastedSamples, setPastedSamples] = useState('');
  const [newFactInput, setNewFactInput] = useState('');
  const [distilling, setDistilling] = useState(false);
  const [distillNotice, setDistillNotice] = useState<string | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreset(aiEnginePreset);
    setHandoffTarget(webHandoffTarget);
    setLocalAllowed(allowLocalCompute);
    setPrivateSession(privateSessionPerGeneration);
    setUnlocked(advancedOverrideEnabled);
    setGenModel(generationModel);
    setQualModel(qualityModel);
    setEndpoint(customEndpointUrl);
    setQualPrompt(qualitySystemPromptOverride || lockedQualityPrompt);
    setToneOn(learnedToneEnabled);
    setToneSummary(learnedToneSummary);
    setFacts(learnedFacts);
    setReviewsUsed(learnedReviewsUsed);
    setToneUnlocked(learnedToneOverrideEnabled);
    setPastedSamples('');
    setNewFactInput('');
    setDistillNotice(null);
    setDistillError(null);
    setConfirmForget(false);
  }, [
    open,
    aiEnginePreset,
    webHandoffTarget,
    allowLocalCompute,
    privateSessionPerGeneration,
    advancedOverrideEnabled,
    generationModel,
    qualityModel,
    customEndpointUrl,
    qualitySystemPromptOverride,
    lockedQualityPrompt,
    learnedToneEnabled,
    learnedToneSummary,
    learnedFacts,
    learnedReviewsUsed,
    learnedToneOverrideEnabled,
  ]);

  if (!open) return null;

  const historyCandidates = reviews.filter(
    (r) =>
      r.draftBody?.trim() ||
      r.liked?.trim() ||
      r.usage?.trim() ||
      r.status === 'posted' ||
      r.status === 'submitted' ||
      r.status === 'completed' ||
      r.status === 'cached_strong'
  );

  async function handleDistillLearnedTone() {
    setDistilling(true);
    setDistillNotice(null);
    setDistillError(null);
    try {
      const res = await fetch('/api/ai/persona/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: historyCandidates.slice(0, 30).map((r) => ({
            asin: r.asin,
            productTitle: r.productTitle,
            orderDateText: r.orderDateText,
            rating: r.rating,
            draftTitle: r.draftTitle,
            draftBody: r.draftBody,
            liked: r.liked,
            disliked: r.disliked,
            usage: r.usage,
            notes: r.notes,
          })),
          externalSamplesText: pastedSamples.trim(),
          existingSummary: toneSummary,
          existingFacts: facts,
          provider: preset === 'web_handoff' ? 'anthropic' : preset,
          model: unlocked ? genModel : undefined,
          endpointUrl: preset === 'custom_endpoint' || unlocked ? endpoint : undefined,
          allowLocalCompute: localAllowed,
          privateSession,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Could not distill learned tone.');
      }
      setToneSummary(data.toneSummary || '');
      setFacts(Array.isArray(data.facts) ? data.facts : []);
      setReviewsUsed(Number(data.reviewsUsed || historyCandidates.length));
      setToneOn(true);
      setDistillNotice(
        `Distilled voice & ${Array.isArray(data.facts) ? data.facts.length : 0} fact(s) from ${Number(
          data.reviewsUsed || historyCandidates.length
        )} item(s). Click Save to persist.`
      );
    } catch (err) {
      setDistillError(err instanceof Error ? err.message : 'Distillation failed.');
    } finally {
      setDistilling(false);
    }
  }

  function handleAddFact() {
    const clean = newFactInput.trim();
    if (!clean) return;
    if (!facts.includes(clean)) {
      setFacts((prev) => [...prev, clean].slice(0, 30));
    }
    setNewFactInput('');
  }

  async function handleSave() {
    setSaving(true);
    try {
      const effectivePreset: AiEnginePreset =
        preset === 'free_local' && !localAllowed ? 'anthropic' : preset;
      await onSave({
        aiEnginePreset: effectivePreset,
        webHandoffTarget: handoffTarget,
        allowLocalCompute: localAllowed,
        privateSessionPerGeneration: privateSession,
        advancedOverrideEnabled: unlocked,
        generationModel: genModel.trim(),
        qualityModel: qualModel.trim(),
        customEndpointUrl: endpoint.trim(),
        qualitySystemPromptOverride:
          unlocked && qualPrompt.trim() !== lockedQualityPrompt.trim()
            ? qualPrompt.trim()
            : '',
        learnedToneEnabled: toneOn,
        learnedToneSummary: toneSummary.trim(),
        learnedFacts: facts.map((f) => f.trim()).filter(Boolean).slice(0, 30),
        learnedReviewsUsed: reviewsUsed,
        learnedToneOverrideEnabled: toneUnlocked,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Advanced: Engine, Private Session &amp; Inspector Override
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Configure cloud AI preselects, isolated per-generation sessions, custom Duck.ai / OpenAI endpoints, and learned reviewer voice.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close advanced settings"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Cloud Engine Preselects */}
          <div className="space-y-3">
            <label className="block font-semibold text-slate-900 dark:text-slate-100">
              Cloud Execution Engine Preselect (Zero Amazon Contact)
            </label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as AiEnginePreset)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="anthropic">
                Dual-Agent Default — Anthropic Claude 3.5 Sonnet + Haiku
                {serverProviders.anthropic ? ' [Ready]' : ' [Cloud Fallback Ready]'}
              </option>
              <option value="custom_openrouter">
                Custom Route: OpenRouter (VineCraft Key — Qwen / Mistral / Claude){serverProviders.custom_openrouter ? ' [Configured]' : ''}
              </option>
              <option value="custom_anthropic">
                Custom Route: Anthropic Console Master Key{serverProviders.custom_anthropic ? ' [Configured]' : ''}
              </option>
              <option value="custom_gemini">
                Custom Route: Gemini Account Key{serverProviders.custom_gemini ? ' [Configured]' : ''}
              </option>
              <option value="web_handoff">
                Web Handoff Round-Trip (Duck.ai / Claude.ai / Qwen / Mistral / ChatGPT / Gemini Web — $0 Tokens)
              </option>
              <option value="custom_endpoint">
                Private Ephemeral Session — Custom Cloud Endpoint / Duck.ai / OpenRouter
              </option>
              <option value="gemini">
                Built-in Gemini Cloud (gemini-4-hydrogen)
                {serverProviders.gemini ? ' [Ready]' : ' [Needs Server Key]'}
              </option>
              <option value="free_local" disabled={!localAllowed}>
                Local Compute / Offline Template Only {localAllowed ? '[Enabled]' : '[Disabled — Opt-in Required Below]'}
              </option>
            </select>

            {preset === 'web_handoff' && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 space-y-2.5">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Default Web Handoff Assistant (Feeds Replies Back Into Form)
                </div>
                <select
                  value={handoffTarget}
                  onChange={(e) => setHandoffTarget(e.target.value as WebHandoffTarget)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="duck">Duck.ai (No Account / Unlimited Free Chat)</option>
                  <option value="claude">Claude.ai Web (Sonnet / Haiku)</option>
                  <option value="qwen">Qwen Chat (chat.qwen.ai)</option>
                  <option value="mistral">Mistral Le Chat (chat.mistral.ai)</option>
                  <option value="chatgpt">ChatGPT Web</option>
                  <option value="gemini">Gemini Web</option>
                </select>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Clicking Generate copies the VineCraft prompt, opens your chosen AI web chat, and listens for your copied reply when you switch back to Studio—automatically parsing Headline, Body, or Quality JSON directly into the form.
                </p>
              </div>
            )}

            {preset === 'custom_endpoint' && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Custom Cloud / Duck.ai Endpoint Configuration
                  </span>
                  <select
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'openrouter') {
                        setEndpoint('https://openrouter.ai/api/v1/chat/completions');
                        setGenModel('qwen/qwen-2.5-72b-instruct:free');
                        setQualModel('mistralai/mistral-small-3.1-24b-instruct:free');
                      } else if (val === 'duck_proxy') {
                        setEndpoint('https://your-duckai-cloud-proxy.example/v1/chat/completions');
                        setGenModel('claude-3-5-haiku');
                        setQualModel('gpt-4o-mini');
                      } else if (val === 'openai') {
                        setEndpoint('https://api.openai.com/v1/chat/completions');
                        setGenModel('gpt-4o');
                        setQualModel('gpt-4o-mini');
                      }
                    }}
                    className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-[11px] text-slate-700 dark:text-slate-200"
                  >
                    <option value="">Load Endpoint Template…</option>
                    <option value="openrouter">OpenRouter Cloud (:free Qwen / Mistral)</option>
                    <option value="duck_proxy">Duck.ai Cloud Bridge / Relay Template</option>
                    <option value="openai">OpenAI Cloud API</option>
                  </select>
                </div>

                <label className="block space-y-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Endpoint URL (HTTPS Cloud Relay / OpenAI-Compatible)
                  </span>
                  <input
                    type="url"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://your-private-relay.example/v1/chat/completions"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="block space-y-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Generation Model ID
                    </span>
                    <input
                      type="text"
                      value={genModel}
                      onChange={(e) => setGenModel(e.target.value)}
                      placeholder="e.g. claude-3-5-sonnet-latest or gpt-4o-mini"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Quality Inspector Model ID
                    </span>
                    <input
                      type="text"
                      value={qualModel}
                      onChange={(e) => setQualModel(e.target.value)}
                      placeholder="e.g. claude-3-5-haiku-latest"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="flex items-start justify-between gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-3 cursor-pointer">
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Private Ephemeral Session
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Fresh stateless session UUID per review &amp; inspection (no cookies, no history, 0 Amazon calls).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={privateSession}
                  onChange={(e) => setPrivateSession(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>

              <label className="flex items-start justify-between gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-3 cursor-pointer">
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    Allow Local Compute (Opt-In)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Keep unchecked for strictly cloud execution. Enable only if you deliberately want offline template fallback or an opted-in local relay.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={localAllowed}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setLocalAllowed(checked);
                    if (!checked && preset === 'free_local') {
                      setPreset('anthropic');
                    }
                  }}
                  className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
              </label>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Security rule: API keys are never entered or stored in the browser UI. Server credentials live strictly in server environment configuration (<code>ANTHROPIC_API_KEY</code>, <code>GEMINI_API_KEY</code>, <code>CUSTOM_GEMINI_API_KEY</code>, <code>CUSTOM_ANTHROPIC_API_KEY</code>, <code>OPENROUTER_API_KEY</code>, <code>CUSTOM_AI_API_KEY</code>).
            </p>
          </div>

          {/* Learned Tone & Reviewer Persona (with Gated Unlock + Warning) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4 bg-slate-50/70 dark:bg-slate-800/30">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Learned Reviewer Tone & Persona
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Learns how you write and factual product/setup context from your previously ordered items & past reviews ({historyCandidates.length} tracked in Studio DB{reviewsUsed ? `, ${reviewsUsed} analyzed` : ''}).
                </p>
              </div>
              <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer">
                <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                  {toneOn ? 'Active' : 'Off'}
                </span>
                <input
                  type="checkbox"
                  checked={toneOn}
                  onChange={(e) => setToneOn(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </label>
            </div>

            {/* Distillation Box */}
            <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-700">
              <label className="block space-y-1">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Optional: Paste Past Amazon Reviews or Ordered Items to Learn From
                </span>
                <textarea
                  value={pastedSamples}
                  onChange={(e) => setPastedSamples(e.target.value)}
                  rows={3}
                  placeholder="Paste 2-10 of your published Amazon reviews or ordered product titles here (or import your Reviewed page via the Firefox Companion popup), then click Distill…"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleDistillLearnedTone}
                  disabled={distilling || (historyCandidates.length === 0 && !pastedSamples.trim())}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="size-3.5" />
                  {distilling ? 'Distilling Learned Tone…' : 'Distill Learned Tone from History'}
                </button>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {facts.length} learned fact{facts.length === 1 ? '' : 's'} stored
                </span>
              </div>

              {distillNotice && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-800 dark:text-emerald-300">
                  {distillNotice}
                </div>
              )}
              {distillError && (
                <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[11px] text-rose-700 dark:text-rose-300">
                  {distillError}
                </div>
              )}
            </div>

            {/* Read-only preview when locked */}
            {!toneUnlocked && (toneSummary || facts.length > 0) && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 space-y-2">
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Current Learned Tone Preview (Locked)
                </div>
                {toneSummary && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {toneSummary}
                  </p>
                )}
                {facts.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-4">
                    {facts.map((fact, idx) => (
                      <li key={idx}>{fact}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Gated Unlock Toggle for Learned Tone */}
            <label className="flex items-start justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-700 cursor-pointer">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  {toneUnlocked ? (
                    <Unlock className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <Lock className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  )}
                  <span>Unlock Learned Tone & Persona Facts Editor</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Locked by default so your distilled voice stays grounded in your real orders & reviews. Unlock to tweak the voice summary or edit learned facts.
                </p>
              </div>
              <input
                type="checkbox"
                checked={toneUnlocked}
                onChange={(e) => setToneUnlocked(e.target.checked)}
                className="mt-1 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
            </label>

            {toneUnlocked && (
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-[11px] text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Warning:</strong> Manually editing your Learned Tone or Persona Facts overrides what the AI distilled from your real orders & reviews. Keep traits truthful and grounded in your actual setup—invented claims or robotic rules may cause drafts to fail Originality or ASIN/Product Match inspections.
                  </span>
                </div>

                <label className="block space-y-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Learned Voice & Tone Summary
                  </span>
                  <textarea
                    value={toneSummary}
                    onChange={(e) => setToneSummary(e.target.value)}
                    rows={4}
                    placeholder="Describe your writing voice, opening style, pacing, and review habits..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 leading-relaxed"
                  />
                </label>

                <div className="space-y-2">
                  <div className="font-medium text-slate-700 dark:text-slate-300">
                    What It Learned ({facts.length} facts)
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newFactInput}
                      onChange={(e) => setNewFactInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddFact();
                        }
                      }}
                      placeholder="Add a factual context note (e.g. Tests audio gear with USB-C DAC)…"
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={handleAddFact}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      <Plus className="size-3.5" />
                      Add
                    </button>
                  </div>

                  {facts.length > 0 && (
                    <ul className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950">
                      {facts.map((fact, idx) => (
                        <li
                          key={`${idx}-${fact.slice(0, 18)}`}
                          className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-slate-700 dark:text-slate-300"
                        >
                          <span className="min-w-0 flex-1">{fact}</span>
                          <button
                            type="button"
                            onClick={() => setFacts((prev) => prev.filter((_, i) => i !== idx))}
                            aria-label="Remove learned fact"
                            className="text-slate-400 hover:text-rose-600 shrink-0 p-0.5"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    {!confirmForget ? (
                      <button
                        type="button"
                        onClick={() => setConfirmForget(true)}
                        disabled={!toneSummary && facts.length === 0}
                        className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-40"
                      >
                        Forget Everything Learned…
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-rose-700 dark:text-rose-300 font-medium">
                          Clear learned voice & facts?
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setToneSummary('');
                            setFacts([]);
                            setReviewsUsed(0);
                            setConfirmForget(false);
                          }}
                          className="px-2 py-0.5 rounded bg-rose-600 text-white font-medium"
                        >
                          Confirm Clear
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmForget(false)}
                          className="text-slate-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Protected Quality Inspector Override Gate */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4 bg-slate-50/70 dark:bg-slate-800/30">
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  {unlocked ? (
                    <Unlock className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <Lock className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  )}
                  <span>Unlock Model & Quality Inspector Prompt Override</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Keep locked to guarantee the Quality Inspection prompt stays unmodified. Unlock only if you want custom model IDs, a custom endpoint URL, or a modified Quality Inspector prompt.
                </p>
              </div>
              <input
                type="checkbox"
                checked={unlocked}
                onChange={(e) => setUnlocked(e.target.checked)}
                className="mt-1 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
            </label>

            {unlocked && (
              <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                <div className="space-y-1.5">
                  <span className="font-medium text-slate-700 dark:text-slate-300 block">
                    Quick-Pick Model Pair (or type any custom model ID below)
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      {
                        label: 'Dual-Agent Default (Sonnet 3.5 + Haiku 3.5)',
                        preset: 'anthropic' as AiEnginePreset,
                        gen: 'claude-3-5-sonnet-latest',
                        qual: 'claude-3-5-haiku-latest',
                      },
                      {
                        label: 'Claude Opus + Haiku',
                        preset: 'anthropic' as AiEnginePreset,
                        gen: 'claude-3-opus-latest',
                        qual: 'claude-3-5-haiku-latest',
                      },
                      {
                        label: 'Custom OpenRouter (Qwen 72B + Mistral 24B)',
                        preset: 'custom_openrouter' as AiEnginePreset,
                        gen: 'qwen/qwen-2.5-72b-instruct:free',
                        qual: 'mistralai/mistral-small-3.1-24b-instruct:free',
                      },
                      {
                        label: 'Custom Anthropic (Sonnet + Haiku)',
                        preset: 'custom_anthropic' as AiEnginePreset,
                        gen: 'claude-3-5-sonnet-latest',
                        qual: 'claude-3-5-haiku-latest',
                      },
                      {
                        label: 'Custom Gemini (4 Hydrogen)',
                        preset: 'custom_gemini' as AiEnginePreset,
                        gen: 'gemini-4-hydrogen',
                        qual: 'gemini-4-hydrogen',
                      },
                      {
                        label: 'Gemini 4 Hydrogen',
                        preset: 'gemini' as AiEnginePreset,
                        gen: 'gemini-4-hydrogen',
                        qual: 'gemini-4-hydrogen',
                      },
                    ].map((pair) => (
                      <button
                        key={pair.label}
                        type="button"
                        onClick={() => {
                          setPreset(pair.preset);
                          setGenModel(pair.gen);
                          setQualModel(pair.qual);
                        }}
                        className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {pair.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 block">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Generation Model ID
                    </span>
                    <input
                      type="text"
                      value={genModel}
                      onChange={(e) => setGenModel(e.target.value)}
                      placeholder="e.g. claude-3-5-sonnet-latest or qwen/qwen-2.5-72b-instruct:free"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Quality Inspector Model ID
                    </span>
                    <input
                      type="text"
                      value={qualModel}
                      onChange={(e) => setQualModel(e.target.value)}
                      placeholder="e.g. claude-3-5-haiku-latest or mistralai/mistral-small-3.1-24b-instruct:free"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                    />
                  </label>
                </div>

                <label className="space-y-1 block">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Custom HTTPS OpenAI-Compatible Endpoint URL (Server-Proxied)
                  </span>
                  <input
                    type="url"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value)}
                    placeholder="https://openrouter.ai/api/v1/chat/completions"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
                  />
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Supports HTTPS OpenAI-compatible cloud endpoints and OpenRouter relays (optional bearer token via server <code>CUSTOM_AI_API_KEY</code>).
                  </span>
                </label>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Quality Inspection System Prompt Override
                    </span>
                    <button
                      type="button"
                      onClick={() => setQualPrompt(lockedQualityPrompt)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="size-3" />
                      Reset to Locked Default
                    </button>
                  </div>
                  <textarea
                    value={qualPrompt}
                    onChange={(e) => setQualPrompt(e.target.value)}
                    rows={7}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-900 dark:text-slate-100 leading-relaxed"
                  />
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    <ShieldAlert className="size-3.5 shrink-0" />
                    <span>
                      Keep ASIN/product matching and originality rules intact so Strong DB caching stays reliable.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {saving ? 'Saving…' : 'Save Advanced Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}
