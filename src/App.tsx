import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity, AlertCircle, CheckCircle2, ChevronRight, ChevronDown,
  Download, ExternalLink, Filter, LayoutDashboard, Loader2, Play,
  Search, ShieldAlert, AlertTriangle, RefreshCw, ArrowUpRight,
  Clock, Globe, Link2, FileWarning, Image, Code, Zap, X, Plus,
  FlaskConical, ChevronUp, Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ─── Types ───

interface AuditIssue {
  type: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  message: string;
  details?: any;
}

interface PageResult {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  h1s: string[];
  h2s: string[];
  wordCount: number;
  canonical: string | null;
  hasSchema: boolean;
  schemaTypes: string[];
  issues: AuditIssue[];
  score: number;
}

interface AuditState {
  status: 'idle' | 'crawling' | 'completed' | 'error';
  progress: number;
  totalUrls: number;
  processedUrls: number;
  results: PageResult[];
  startTime: string | null;
  endTime: string | null;
  error: string | null;
  message: string | null;
  site?: string;
}

type SiteKey = 'prod' | 'dev';

const SITE_LABELS: Record<SiteKey, string> = {
  prod: 'journeyrouters.com',
  dev: 'devbranch.amplify',
};

// ─── Helpers ───

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; border: string; icon: any }> = {
  Critical: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: ShieldAlert },
  High: { color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', icon: AlertCircle },
  Medium: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle },
  Low: { color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200', icon: AlertTriangle },
};

const ISSUE_TYPE_ICONS: Record<string, any> = {
  'SEO': Globe,
  'Technical': Code,
  'Broken Page': FileWarning,
  'Broken Link (Internal)': Link2,
  'Broken Link (External)': Link2,
  'Performance': Zap,
  'Content': FileWarning,
  'Redirect': ArrowUpRight,
};

function shortUrl(url: string) {
  try {
    return new URL(url).pathname || '/';
  } catch { return url; }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const EMPTY_AUDIT: AuditState = {
  status: 'idle', progress: 0, totalUrls: 0, processedUrls: 0,
  results: [], startTime: null, endTime: null, error: null, message: null,
};

// ─── Results Table (shared between full audit and custom audit) ───────

function ResultsTable({ results, emptyMessage }: { results: PageResult[]; emptyMessage: string }) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [selectedPage, setSelectedPage] = useState<PageResult | null>(null);

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-8"></th>
              <th className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Page</th>
              <th className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Score</th>
              <th className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Issues</th>
              <th className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">H1</th>
              <th className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {results.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-slate-400">{emptyMessage}</td>
              </tr>
            ) : results.map((page, idx) => (
              <React.Fragment key={idx}>
                <tr className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => toggleRow(idx)}>
                  <td className="pl-5 py-3">
                    <ChevronRight size={14} className={`text-slate-400 transition-transform ${expandedRows.has(idx) ? 'rotate-90' : ''}`} />
                  </td>
                  <td className="px-5 py-3 max-w-[280px]">
                    <p className="text-sm font-medium text-slate-900 truncate">{shortUrl(page.url)}</p>
                    <p className="text-[11px] text-slate-400 truncate">{page.title || 'No title'}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-sm font-bold ${page.score > 70 ? 'text-emerald-600' : page.score > 40 ? 'text-amber-600' : 'text-red-600'}`}>
                      {page.score}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {page.issues.length > 0 ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        page.issues.some(i => i.severity === 'Critical') ? 'bg-red-50 text-red-700 border border-red-200' :
                          page.issues.some(i => i.severity === 'High') ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                            'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {page.issues.length} {page.issues.length === 1 ? 'issue' : 'issues'}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Healthy</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium ${page.status === 200 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {page.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 max-w-[160px]">
                    <p className="text-xs text-slate-500 truncate">{page.h1s?.[0] || '—'}</p>
                  </td>
                  <td className="pr-5 py-3">
                    <button onClick={e => { e.stopPropagation(); setSelectedPage(page); }}
                      className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all">
                      <ExternalLink size={14} />
                    </button>
                  </td>
                </tr>
                {expandedRows.has(idx) && page.issues.length > 0 && (
                  <tr>
                    <td colSpan={7} className="bg-slate-50 px-10 py-4">
                      <div className="space-y-2">
                        {page.issues.map((issue, iIdx) => {
                          const sev = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.Low;
                          const Icon = sev.icon;
                          return (
                            <div key={iIdx} className={`flex items-start gap-3 p-3 rounded-lg border ${sev.bg} ${sev.border}`}>
                              <Icon size={16} className={`${sev.color} mt-0.5 shrink-0`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className={`text-[10px] font-bold uppercase ${sev.color}`}>{issue.severity}</span>
                                  <span className="text-[10px] text-slate-400">·</span>
                                  <span className="text-[10px] font-medium text-slate-500">{issue.type}</span>
                                </div>
                                <p className="text-sm text-slate-800">{issue.message}</p>
                                {issue.details && (
                                  <pre className="mt-1.5 text-[11px] text-slate-500 bg-white/60 rounded p-2 overflow-x-auto" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                                    {typeof issue.details === 'string' ? issue.details :
                                      Array.isArray(issue.details) ? issue.details.map((d: any) =>
                                        typeof d === 'string' ? d : `${d.url} → ${d.status}`
                                      ).join('\n') : JSON.stringify(issue.details, null, 2)}
                                  </pre>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Slide-over Panel */}
      <AnimatePresence>
        {selectedPage && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex justify-end" onClick={() => setSelectedPage(null)}>
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-2xl bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-lg font-bold">Page audit details</h3>
                <button onClick={() => setSelectedPage(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-6">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">URL</p>
                  <a href={selectedPage.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-emerald-600 hover:underline break-all flex items-center gap-1">
                    {selectedPage.url} <ExternalLink size={12} />
                  </a>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Score</p>
                    <p className={`text-xl font-bold ${selectedPage.score > 70 ? 'text-emerald-600' : selectedPage.score > 40 ? 'text-amber-600' : 'text-red-600'}`}>{selectedPage.score}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Status</p>
                    <p className="text-xl font-bold">{selectedPage.status}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Words</p>
                    <p className="text-xl font-bold">{selectedPage.wordCount || 0}</p>
                  </div>
                </div>
                <div className="mb-6 space-y-3">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Title</p>
                    <p className="text-sm">{selectedPage.title || <span className="text-red-500 italic">Missing</span>}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Meta Description</p>
                    <p className="text-sm">{selectedPage.metaDescription || <span className="text-red-500 italic">Missing</span>}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">H1</p>
                    <p className="text-sm">{selectedPage.h1s?.join(', ') || <span className="text-red-500 italic">Missing</span>}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Canonical</p>
                    <p className="text-sm" style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}>{selectedPage.canonical || <span className="text-red-500 italic">Missing</span>}</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                    <AlertCircle size={16} className="text-emerald-600" />
                    Issues ({selectedPage.issues.length})
                  </h4>
                  {selectedPage.issues.length === 0 ? (
                    <div className="p-8 text-center bg-emerald-50 rounded-2xl border border-emerald-100">
                      <CheckCircle2 size={36} className="mx-auto text-emerald-500 mb-2" />
                      <p className="font-bold text-emerald-800">No issues found</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedPage.issues.map((issue, i) => {
                        const sev = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.Low;
                        const Icon = sev.icon;
                        return (
                          <div key={i} className={`p-3 rounded-xl border ${sev.bg} ${sev.border}`}>
                            <div className="flex items-start gap-3">
                              <Icon size={16} className={`${sev.color} mt-0.5 shrink-0`} />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className={`text-[10px] font-bold uppercase ${sev.color}`}>{issue.severity}</span>
                                  <span className="text-[10px] text-slate-400">·</span>
                                  <span className="text-[10px] font-medium text-slate-500">{issue.type}</span>
                                </div>
                                <p className="text-sm">{issue.message}</p>
                                {issue.details && (
                                  <pre className="mt-1.5 text-[11px] text-slate-500 bg-white/50 rounded p-2 overflow-x-auto whitespace-pre-wrap" style={{ fontFamily: '"JetBrains Mono", monospace' }}>
                                    {typeof issue.details === 'string' ? issue.details :
                                      Array.isArray(issue.details) ? issue.details.map((d: any) =>
                                        typeof d === 'string' ? d : `${d.url} → ${d.status}`
                                      ).join('\n') : JSON.stringify(issue.details, null, 2)}
                                  </pre>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── App ───

export default function App() {
  const [audit, setAudit] = useState<AuditState>(EMPTY_AUDIT);
  const [customAudit, setCustomAudit] = useState<AuditState>(EMPTY_AUDIT);
  const [activeSite, setActiveSite] = useState<SiteKey>('prod');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [sortBy, setSortBy] = useState<'score' | 'issues' | 'url'>('score');
  const [isConnError, setIsConnError] = useState(false);

  // Custom URL test panel state
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');

  // ── Polling: full audit ──
  useEffect(() => {
    let retryCount = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch('/api/audit/status', { signal: ctrl.signal });
        clearTimeout(timer);

        if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
          retryCount++;
          if (retryCount > 5) setIsConnError(true);
          timeoutId = setTimeout(poll, 5000);
          return;
        }

        const data = await res.json();
        retryCount = 0;
        setIsConnError(false);
        setAudit(data);
        timeoutId = setTimeout(poll, data.status === 'crawling' ? 3000 : 8000);
      } catch {
        retryCount++;
        if (retryCount > 5) setIsConnError(true);
        timeoutId = setTimeout(poll, 10000);
      }
    };

    poll();
    return () => clearTimeout(timeoutId);
  }, []);

  // ── Polling: custom audit ──
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch('/api/custom-audit/status');
        if (res.ok) {
          const data = await res.json();
          setCustomAudit(data);
          timeoutId = setTimeout(poll, data.status === 'crawling' ? 3000 : 10000);
        } else {
          timeoutId = setTimeout(poll, 10000);
        }
      } catch {
        timeoutId = setTimeout(poll, 10000);
      }
    };

    poll();
    return () => clearTimeout(timeoutId);
  }, []);

  // ── Actions ──
  const startAudit = () => fetch('/api/audit/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: activeSite }),
  });

  const resetAudit = () => fetch('/api/audit/reset', { method: 'POST' });
  const downloadCSV = () => window.open('/api/audit/download', '_blank');

  const startCustomAudit = () => {
    const urls = customUrlInput
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.startsWith('http'));
    if (urls.length === 0) return;
    fetch('/api/custom-audit/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, site: activeSite }),
    });
  };

  const resetCustomAudit = () => {
    fetch('/api/custom-audit/reset', { method: 'POST' });
    setCustomUrlInput('');
  };

  // ── Computed Stats ──
  const stats = useMemo(() => {
    const r = audit.results;
    const totalIssues = r.reduce((a, p) => a + p.issues.length, 0);
    const critical = r.reduce((a, p) => a + p.issues.filter(i => i.severity === 'Critical').length, 0);
    const high = r.reduce((a, p) => a + p.issues.filter(i => i.severity === 'High').length, 0);
    const avgScore = r.length ? Math.round(r.reduce((a, p) => a + p.score, 0) / r.length) : 0;
    const healthyPages = r.filter(p => p.issues.length === 0).length;

    const typeBreakdown: Record<string, number> = {};
    r.forEach(p => p.issues.forEach(i => {
      typeBreakdown[i.type] = (typeBreakdown[i.type] || 0) + 1;
    }));

    return { totalIssues, critical, high, avgScore, healthyPages, typeBreakdown };
  }, [audit.results]);

  // ── Filtered results ──
  const filtered = useMemo(() => {
    let results = audit.results.filter(page => {
      const matchSearch = page.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (page.title || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchSeverity = filterSeverity === 'All' || page.issues.some(i => i.severity === filterSeverity);
      const matchType = filterType === 'All' || page.issues.some(i => i.type === filterType);
      return matchSearch && matchSeverity && matchType;
    });

    if (sortBy === 'score') results.sort((a, b) => a.score - b.score);
    else if (sortBy === 'issues') results.sort((a, b) => b.issues.length - a.issues.length);
    else results.sort((a, b) => a.url.localeCompare(b.url));

    return results;
  }, [audit.results, searchTerm, filterSeverity, filterType, sortBy]);

  const issueTypes = useMemo(() => {
    const types = new Set<string>();
    audit.results.forEach(p => p.issues.forEach(i => types.add(i.type)));
    return ['All', ...Array.from(types).sort()];
  }, [audit.results]);

  // ── Parsed custom URLs for validation feedback ──
  const parsedCustomUrls = useMemo(() => {
    return customUrlInput
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0);
  }, [customUrlInput]);

  const validCustomUrls = parsedCustomUrls.filter(u => u.startsWith('http'));

  // ── Render ──
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: '"DM Sans", sans-serif' }}>

      {/* ── Header ── */}
      <header className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-sky-500 rounded-xl flex items-center justify-center">
            <Activity size={20} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight">SiteHealth</h1>
            <p className="text-[11px] text-slate-400 -mt-0.5">{SITE_LABELS[activeSite]}</p>
          </div>
          {isConnError ? (
            <span className="ml-3 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full animate-pulse">RECONNECTING</span>
          ) : (
            <span className="ml-3 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">ONLINE</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* ── Site Toggle ── */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setActiveSite('prod')}
              className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                activeSite === 'prod'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Prod
            </button>
            <button
              onClick={() => setActiveSite('dev')}
              className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                activeSite === 'dev'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Dev
            </button>
          </div>

          {audit.status === 'crawling' && (
            <button onClick={() => resetAudit()} className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors">
              STOP
            </button>
          )}
          <button onClick={downloadCSV} disabled={audit.results.length === 0} className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg border border-slate-200 disabled:opacity-30 transition-colors" title="Download CSV">
            <Download size={18} />
          </button>
          <button onClick={() => startAudit()} className={`flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-all ${
            audit.status === 'crawling' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.97]'
          }`}>
            {audit.status === 'crawling' ? <><RefreshCw size={16} className="animate-spin" /> Auditing...</> :
              <><Play size={16} fill="currentColor" /> {audit.status === 'idle' ? 'Start Audit' : 'Re-run'}</>}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">

        {/* ── Error Banner ── */}
        <AnimatePresence>
          {audit.status === 'error' && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-6 p-5 bg-red-50 rounded-2xl border border-red-200 flex items-center gap-4">
              <ShieldAlert size={24} className="text-red-600 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-900">Audit Failed</p>
                <p className="text-sm text-red-600">{audit.error}</p>
              </div>
              <button onClick={() => startAudit()} className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700">Retry</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Progress ── */}
        <AnimatePresence>
          {audit.status === 'crawling' && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-6 p-5 bg-white rounded-2xl border border-emerald-100 shadow-sm">
              <div className="flex justify-between items-end mb-3">
                <div>
                  <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                    Crawling sitemap
                    {audit.site && (
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${audit.site === 'dev' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {audit.site === 'dev' ? 'DEV' : 'PROD'}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">{audit.message}</p>
                </div>
                <span className="text-2xl font-black text-emerald-600">{audit.progress}%</span>
              </div>
              <div className="h-2 w-full bg-emerald-50 rounded-full overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 rounded-full"
                  initial={{ width: 0 }} animate={{ width: `${audit.progress}%` }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.5 }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Health Score', value: `${stats.avgScore}%`, color: stats.avgScore > 70 ? 'text-emerald-600' : stats.avgScore > 40 ? 'text-amber-600' : 'text-red-600' },
            { label: 'Pages Crawled', value: audit.results.length, color: 'text-slate-900' },
            { label: 'Total Issues', value: stats.totalIssues, color: stats.totalIssues > 0 ? 'text-red-600' : 'text-emerald-600' },
            { label: 'Critical', value: stats.critical, color: stats.critical > 0 ? 'text-red-600' : 'text-emerald-600' },
            { label: 'Healthy Pages', value: stats.healthyPages, color: 'text-emerald-600' },
          ].map((s, i) => (
            <div key={i} className="bg-white p-4 rounded-xl border border-slate-200">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── Issue Type Breakdown ── */}
        {Object.keys(stats.typeBreakdown).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {Object.entries(stats.typeBreakdown)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([type, count]) => {
                const Icon = ISSUE_TYPE_ICONS[type] || AlertTriangle;
                const isActive = filterType === type;
                return (
                  <button key={type} onClick={() => setFilterType(isActive ? 'All' : type)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      isActive ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
                    <Icon size={13} />
                    <span className="font-bold">{count}</span>
                    <span>{type}</span>
                  </button>
                );
              })}
          </div>
        )}

        {/* ── Custom URL Test Panel ── */}
        <div className="mb-6 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowCustomPanel(p => !p)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-indigo-50 rounded-lg flex items-center justify-center">
                <FlaskConical size={15} className="text-indigo-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Custom URL Test</p>
                <p className="text-[11px] text-slate-400">Audit specific pages without a full site crawl</p>
              </div>
              {customAudit.status === 'crawling' && (
                <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full animate-pulse">
                  RUNNING {customAudit.processedUrls}/{customAudit.totalUrls}
                </span>
              )}
              {customAudit.status === 'completed' && customAudit.results.length > 0 && (
                <span className="ml-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  {customAudit.results.length} PAGE{customAudit.results.length !== 1 ? 'S' : ''} TESTED
                </span>
              )}
            </div>
            {showCustomPanel
              ? <ChevronUp size={16} className="text-slate-400" />
              : <ChevronDown size={16} className="text-slate-400" />
            }
          </button>

          <AnimatePresence>
            {showCustomPanel && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 border-t border-slate-100">
                  {/* Input area */}
                  <div className="pt-4">
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      URLs to test — one per line
                    </label>
                    <textarea
                      value={customUrlInput}
                      onChange={e => setCustomUrlInput(e.target.value)}
                      placeholder={`https://www.journeyrouters.com/about\nhttps://www.journeyrouters.com/contact\nhttps://www.journeyrouters.com/blog`}
                      rows={5}
                      disabled={customAudit.status === 'crawling'}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y disabled:opacity-60"
                      style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}
                    />
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[11px] text-slate-400">
                        {parsedCustomUrls.length > 0 && (
                          <>
                            <span className="text-emerald-600 font-semibold">{validCustomUrls.length} valid</span>
                            {parsedCustomUrls.length !== validCustomUrls.length && (
                              <span className="text-red-500 ml-2">{parsedCustomUrls.length - validCustomUrls.length} invalid (must start with http)</span>
                            )}
                          </>
                        )}
                      </p>
                      <div className="flex items-center gap-2">
                        {(customAudit.status === 'completed' || customAudit.status === 'error') && (
                          <button
                            onClick={resetCustomAudit}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <Trash2 size={13} /> Clear
                          </button>
                        )}
                        {customAudit.status === 'crawling' ? (
                          <button
                            onClick={() => fetch('/api/custom-audit/reset', { method: 'POST' })}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            onClick={startCustomAudit}
                            disabled={validCustomUrls.length === 0}
                            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <FlaskConical size={13} />
                            {customAudit.status === 'completed' ? 'Re-test' : 'Run Test'}
                            {validCustomUrls.length > 0 && <span className="ml-1 opacity-80">({validCustomUrls.length})</span>}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Custom audit progress */}
                  <AnimatePresence>
                    {customAudit.status === 'crawling' && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                        <div className="flex justify-between items-center mb-2">
                          <p className="text-xs text-indigo-700 font-medium">{customAudit.message}</p>
                          <span className="text-sm font-bold text-indigo-700">{customAudit.progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-indigo-100 rounded-full overflow-hidden">
                          <motion.div className="h-full bg-indigo-500 rounded-full"
                            initial={{ width: 0 }} animate={{ width: `${customAudit.progress}%` }}
                            transition={{ type: 'spring', bounce: 0, duration: 0.5 }} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Custom audit error */}
                  {customAudit.status === 'error' && (
                    <div className="mt-4 p-4 bg-red-50 rounded-xl border border-red-200 flex items-center gap-3">
                      <ShieldAlert size={18} className="text-red-600 shrink-0" />
                      <p className="text-sm text-red-700">{customAudit.error}</p>
                    </div>
                  )}

                  {/* Custom audit results */}
                  {customAudit.results.length > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                          Test Results — {customAudit.results.length} page{customAudit.results.length !== 1 ? 's' : ''}
                          {customAudit.endTime && (
                            <span className="ml-2 font-normal normal-case text-slate-400">· {timeAgo(customAudit.endTime)}</span>
                          )}
                        </p>
                        <div className="flex gap-3 text-[11px]">
                          {['Critical', 'High', 'Medium'].map(sev => {
                            const count = customAudit.results.reduce(
                              (a: number, p: PageResult) => a + p.issues.filter((i: AuditIssue) => i.severity === sev).length, 0
                            );
                            if (count === 0) return null;
                            const cfg = SEVERITY_CONFIG[sev];
                            return (
                              <span key={sev} className={`px-2 py-0.5 rounded-full font-bold border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                                {count} {sev}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <ResultsTable
                        results={customAudit.results}
                        emptyMessage="No results yet"
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input type="text" placeholder="Search by URL or title..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none">
            <option value="All">All severities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none">
            <option value="score">Sort: Worst first</option>
            <option value="issues">Sort: Most issues</option>
            <option value="url">Sort: URL A-Z</option>
          </select>
          {(filterType !== 'All' || filterSeverity !== 'All' || searchTerm) && (
            <button onClick={() => { setFilterType('All'); setFilterSeverity('All'); setSearchTerm(''); }}
              className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-xl hover:bg-red-50 flex items-center gap-1">
              <X size={14} /> Clear
            </button>
          )}
        </div>

        {/* ── Full Audit Results Table ── */}
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Full Audit Results
            </p>
            {audit.site && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                audit.site === 'dev'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {audit.site === 'dev' ? 'DEV BRANCH' : 'PRODUCTION'}
              </span>
            )}
          </div>
          <ResultsTable
            results={filtered}
            emptyMessage={
              audit.status === 'idle' ? 'Start an audit to see results' :
                audit.status === 'crawling' ? 'Crawling in progress — results appearing...' :
                  'No results match your filters'
            }
          />
          <div className="px-5 py-3 border border-slate-200 border-t-0 rounded-b-2xl bg-slate-50 text-[11px] text-slate-400 flex justify-between -mt-px">
            <span>Showing {filtered.length} of {audit.results.length} pages</span>
            {audit.endTime && <span>Completed {timeAgo(audit.endTime)}</span>}
          </div>
        </div>

      </main>
    </div>
  );
}
