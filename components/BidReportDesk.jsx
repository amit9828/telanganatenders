'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, FileText, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { workflowFetch } from '@/components/workflow/api';

const NONE = 'Not stated in this tender';

function scriptParts(markdown) {
  const marker = '# SCRIPT 2 (Full Simple English Report)';
  const at = String(markdown || '').indexOf(marker);
  if (at < 0) return { te: markdown || '', en: markdown || '', both: markdown || '' };
  return {
    te: markdown.slice(0, at).trim(),
    en: markdown.slice(at).trim(),
    both: markdown,
  };
}

function Points({ items, numbered }) {
  if (!items?.length) return <p className="text-sm text-slate-500">{NONE}</p>;
  const List = numbered ? 'ol' : 'ul';
  return (
    <List className={`space-y-2 text-sm text-slate-800 ${numbered ? 'list-decimal pl-5' : 'list-disc pl-5'}`}>
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          {item.title ? <span className="font-semibold">{item.title}. </span> : null}
          {item.text}
          {item.quantity ? <span className="font-semibold"> — {item.quantity}</span> : null}
          {item.children?.length ? (
            <ul className="mt-1 list-disc pl-5 text-slate-700">
              {item.children.map((child, childIndex) => (
                <li key={childIndex}>{child.text}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </List>
  );
}

function Blocks({ blocks }) {
  return (blocks || []).map((block, index) => {
    if (block.kind === 'table') {
      return (
        <div key={index} className="overflow-x-auto">
          <table className="w-full text-sm border border-slate-200">
            <thead className="bg-slate-50">
              <tr>{block.columns.map((column) => <th key={column} className="border px-2 py-1 text-left">{column}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border px-2 py-1">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.kind === 'numbered') return <Points key={index} items={block.items} numbered />;
    return <Points key={index} items={[block]} numbered={false} />;
  });
}

const WORD_TABLE = "border-collapse:collapse; width:100%; font-family:'Nirmala UI','Segoe UI',sans-serif; font-size:11pt; border:1px solid #cbd5e1;";
const WORD_TH = 'background-color:#f1f5f9; font-weight:bold; border:1px solid #cbd5e1; padding:8px; text-align:left;';
const WORD_TD = 'border:1px solid #cbd5e1; padding:8px;';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlTable(columns, rows) {
  const head = columns.map((column) => `<th style="${WORD_TH}">${esc(column)}</th>`).join('');
  const body = (rows || []).map((row) => `<tr>${row.map((cell) => `<td style="${WORD_TD}">${esc(cell)}</td>`).join('')}</tr>`).join('');
  return `<table border="1" cellspacing="0" cellpadding="6" style="${WORD_TABLE}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function htmlPoints(items, numbered) {
  if (!items?.length) return '<p>Not stated in this tender</p>';
  const tag = numbered ? 'ol' : 'ul';
  const body = items.map((item) => {
    const title = item.title ? `<strong>${esc(item.title)}. </strong>` : '';
    const quantity = item.quantity ? ` — ${esc(item.quantity)}` : '';
    const children = item.children?.length ? htmlPoints(item.children, false) : '';
    return `<li>${title}${esc(item.text || '')}${quantity}${children}</li>`;
  }).join('');
  return `<${tag}>${body}</${tag}>`;
}

function htmlBlocks(blocks) {
  return (blocks || []).map((block) => {
    if (block.kind === 'table') return htmlTable(block.columns, block.rows);
    if (block.kind === 'numbered') return htmlPoints(block.items, true);
    return htmlPoints([block], false);
  }).join('');
}

function reportHtml(report, title) {
  if (!report) return '';
  const parts = [`<h2 style="font-family:'Nirmala UI','Segoe UI',sans-serif;">${esc(title)}</h2>`];
  parts.push('<h3>Part A. Basic details</h3>');
  parts.push(htmlTable(
    ['Sl.', 'Parameter', 'Details'],
    (report.part_a_basic_details?.basic_details_table || []).map((row) => [row.sl, row.parameter, row.details]),
  ));
  parts.push(htmlPoints(report.part_a_basic_details?.basic_details_text, false));
  parts.push('<h3>Part B. Scope of work</h3>');
  for (const section of report.part_b_scope_of_work?.sections || []) {
    parts.push(`<h3>${esc(section.title)}</h3>`);
    parts.push(htmlBlocks(section.blocks));
  }
  parts.push('<h3>Part C. Documents and eligibility</h3>');
  for (const group of report.part_c_documents?.groups || []) {
    parts.push(`<h3>${esc(group.title)}</h3>`);
    parts.push(htmlPoints(group.items, group.numbered));
  }
  parts.push('<h3>Part D. Terms, payment, and penalties</h3>');
  for (const section of report.part_d_terms_payment_penalties?.sections || []) {
    parts.push(`<h3>${esc(section.title)}</h3>`);
    if (section.items) parts.push(htmlPoints(section.items, false));
    if (section.table) parts.push(htmlTable(section.table.columns, section.table.rows));
    if (section.sla_penalties?.length) {
      parts.push(htmlPoints(section.sla_penalties.map((line, index) => ({ title: String(index + 1), text: line })), false));
    }
  }
  return `<div style="font-family:'Nirmala UI','Segoe UI',sans-serif; font-size:11pt;">${parts.join('')}</div>`;
}

export default function BidReportDesk({ initialJobId = '' }) {
  const [tenders, setTenders] = useState([]);
  const [query, setQuery] = useState('');
  const [jobId, setJobId] = useState(initialJobId || '');
  const [bundle, setBundle] = useState(null);
  const [markdown, setMarkdown] = useState('');
  const [script, setScript] = useState('en');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    if (initialJobId) setJobId(String(initialJobId));
  }, [initialJobId]);

  useEffect(() => {
    let cancelled = false;
    workflowFetch('/api/reports/bid')
      .then((data) => { if (!cancelled) setTenders(data.tenders || []); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!jobId) {
      setBundle(null);
      setMarkdown('');
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRunning(true);
    setLoading(true);
    setError('');
    setBundle(null);
    workflowFetch('/api/reports/bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    })
      .then((data) => {
        if (cancelled) return;
        setBundle(data.report);
        setMarkdown(data.markdown || '');
        setSaved(data.saved !== false);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) { setLoading(false); setRunning(false); } });
    return () => { cancelled = true; };
  }, [jobId]);

  const report = script === 'te' ? bundle?.report_te : bundle?.report_en;
  const parts = useMemo(() => scriptParts(markdown), [markdown]);
  const skipped = bundle?.core_details?.downloads_skipped || [];
  const links = bundle?.core_details?.links || [];
  const needle = query.trim();
  const searching = needle.length > 0;
  const matched = useMemo(() => {
    const text = needle.toLowerCase();
    if (!text) return tenders;
    return tenders.filter((row) => [row.bidNo, row.title, row.organisation, row.client].join(' ').toLowerCase().includes(text));
  }, [needle, tenders]);
  const shown = useMemo(() => {
    const selected = tenders.find((row) => row.jobId === jobId);
    if (selected && !matched.some((row) => row.jobId === jobId)) return [selected, ...matched];
    return matched;
  }, [jobId, matched, tenders]);
  const selectLabel = searching
    ? `Select Tender from Suggestion Bar (${matched.length} of ${tenders.length} Tenders)`
    : `Select Tender from Suggestion Bar (${tenders.length} Tenders)`;
  const canAnalyze = searching && matched.length === 0 && /(?:GEM\/\d{4}\/B\/\d+|\d{5,})/i.test(needle);

  async function copy(which) {
    const chosen = [];
    if (which !== 'en') chosen.push({ report: bundle?.report_te, title: 'SCRIPT 1 (Full Telugu Report)' });
    if (which !== 'te') chosen.push({ report: bundle?.report_en, title: 'SCRIPT 2 (Full Simple English Report)' });
    const html = chosen.map((item) => reportHtml(item.report, item.title)).join('<hr/>');
    const text = which === 'te' ? parts.te : which === 'en' ? parts.en : parts.both;
    try {
      if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      toast.success(which === 'both' ? 'Both scripts copied.' : which === 'te' ? 'Telugu script copied.' : 'English script copied.');
    } catch {
      toast.error('Copy failed.');
    }
  }

  async function analyzeBid() {
    const bidNo = query.trim();
    if (!bidNo) return;
    setRunning(true);
    setError('');
    try {
      const data = await workflowFetch('/api/reports/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidNo }),
      });
      setBundle(data.report);
      setMarkdown(data.markdown || '');
      setSaved(data.saved !== false);
      if (data.jobId && tenders.some((row) => row.jobId === data.jobId)) setJobId(data.jobId);
      toast.success(data.saved === false ? 'Shown. A link failed, so this read was not saved.' : 'Report saved.');
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function reread() {
    if (!jobId) return;
    setRunning(true);
    setError('');
    try {
      const data = await workflowFetch('/api/reports/bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, force: true }),
      });
      setBundle(data.report);
      setMarkdown(data.markdown || '');
      setSaved(data.saved !== false);
      toast.success(data.saved === false ? 'Shown. A link failed, so this read was not saved.' : 'Report saved.');
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[#0A2647]"><FileText className="h-5 w-5" /> Bid report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="bid-report-search">Search Suggestion Bar</label>
            <div className="flex gap-2">
              <input
                id="bid-report-search"
                className="h-10 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={query}
                placeholder="Bid number, title, organisation, or client"
                onChange={(event) => setQuery(event.target.value)}
              />
              {searching ? (
                <Button type="button" variant="outline" onClick={() => setQuery('')}>Clear search</Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-sm font-medium text-slate-700" htmlFor="bid-report-tender">
                {selectLabel}
              </label>
              <select
                id="bid-report-tender"
                className="h-10 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={shown.some((row) => row.jobId === jobId) ? jobId : ''}
                onChange={(event) => setJobId(event.target.value)}
              >
                <option value="">{selectLabel}</option>
                {shown.map((row) => <option key={row.jobId} value={row.jobId}>{row.label}</option>)}
              </select>
              <Button type="button" variant="outline" onClick={reread} disabled={running || !jobId}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Read again
              </Button>
            </div>
            {canAnalyze ? (
              <Button type="button" onClick={analyzeBid} disabled={running}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Analyze Bid Number
              </Button>
            ) : null}
          </div>
          <p className="text-sm text-slate-600">
            {running ? 'Reading the bid. A scanned PDF can take several minutes.' : (jobId ? (saved ? 'Saved report' : 'Shown, not saved — a linked file failed') : 'Choose a tender from the Suggestion Bar.')}
            {skipped.length ? `. Not read: ${skipped.join(', ')}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={script === 'te' ? 'default' : 'outline'} onClick={() => setScript('te')}>SCRIPT 1 - తెలుగు</Button>
            <Button type="button" variant={script === 'en' ? 'default' : 'outline'} onClick={() => setScript('en')}>SCRIPT 2 - English</Button>
            <Button type="button" variant="outline" onClick={() => copy('te')}><Copy className="mr-2 h-4 w-4" />Copy Telugu</Button>
            <Button type="button" variant="outline" onClick={() => copy('en')}><Copy className="mr-2 h-4 w-4" />Copy English</Button>
            <Button type="button" variant="outline" onClick={() => copy('both')}><Copy className="mr-2 h-4 w-4" />Copy both</Button>
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-600">Opening the report…</p> : null}

      {report ? (
        <div className="space-y-4">
          {links.length ? (
            <Card>
              <CardHeader><CardTitle>Attached Documents &amp; Links Found in PDF</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {links.map((link) => (
                  <div key={link.url} className="text-sm">
                    <span className="font-medium text-slate-900">{link.label}</span>
                    <span className={link.ok ? 'text-emerald-700' : 'text-red-700'}> — {link.status}</span>
                    <div>
                      <a href={link.url} target="_blank" rel="noreferrer" className="break-all text-blue-700 underline">{link.url}</a>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader><CardTitle>Part A. Basic details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="border px-2 py-1 text-left">Sl.</th>
                      <th className="border px-2 py-1 text-left">Parameter</th>
                      <th className="border px-2 py-1 text-left">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.part_a_basic_details.basic_details_table.map((row) => (
                      <tr key={row.sl}>
                        <td className="border px-2 py-1">{row.sl}</td>
                        <td className="border px-2 py-1">{row.parameter}</td>
                        <td className="border px-2 py-1">{row.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Points items={report.part_a_basic_details.basic_details_text} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Part B. Scope of work</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {report.part_b_scope_of_work.sections.map((section) => (
                <section key={section.title}>
                  <h3 className="mb-2 font-semibold text-[#0A2647]">{section.title}</h3>
                  <Blocks blocks={section.blocks} />
                </section>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Part C. Documents and eligibility</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {report.part_c_documents.groups.map((group) => (
                <section key={group.title}>
                  <h3 className="mb-2 font-semibold text-[#0A2647]">{group.title}</h3>
                  <Points items={group.items} numbered={group.numbered} />
                </section>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Part D. Terms, payment, and penalties</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {report.part_d_terms_payment_penalties.sections.map((section) => (
                <section key={section.title}>
                  <h3 className="mb-2 font-semibold text-[#0A2647]">{section.title}</h3>
                  {section.items ? <Points items={section.items} /> : null}
                  {section.table ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border border-slate-200">
                        <thead className="bg-slate-50">
                          <tr>{section.table.columns.map((column) => <th key={column} className="border px-2 py-1 text-left">{column}</th>)}</tr>
                        </thead>
                        <tbody>
                          {section.table.rows.map((row, index) => (
                            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border px-2 py-1">{cell}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {section.sla_penalties?.length ? <Points items={section.sla_penalties.map((line, index) => ({ title: String(index + 1), text: line }))} /> : null}
                </section>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
