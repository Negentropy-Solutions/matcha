import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import { fmt, fmtDate, roundCurrency, appUrl } from '../../lib/format';
import InvoiceRow from './InvoiceRow';
import Tray from './Tray';

const BAR_PALETTE = [
  'hsl(152, 48%, 38%)',
  'hsl(198, 55%, 42%)',
  'hsl(268, 48%, 45%)',
  'hsl(28, 65%, 48%)',
  'hsl(320, 50%, 45%)',
  'hsl(42, 65%, 45%)',
  'hsl(175, 45%, 40%)',
  'hsl(340, 55%, 42%)',
];

export default function RightPanel() {
  const {
    activePayId,
    selectedPayIds,
    partyFilter,
    invoices,
    loadingInvoices,
    loadingMoreInvoices,
    invoicesHasMore,
    allocations,
    invoiceSearchQ,
    setInvoiceSearchQ,
    invoiceFromDate,
    setInvoiceFromDate,
    invoiceToDate,
    setInvoiceToDate,
    getPayByKey,
    getPaymentInvoices,
    applyInvoiceFilters,
    selectAllInvoices,
    clearTray,
    selectedPaymentsTotal,
    loadMoreInvoices,
    fxVersion,
    currencySymbols,
    currencySymbolOnRight,
  } = useAppStore();

  const p = getPayByKey(activePayId);

  if (!p) {
    // When coming from an invoice exception: party is filtered but no payment exists.
    // Show outstanding invoices for that party so the user understands the context.
    if (partyFilter?.party) {
      return (
        <div className="right" id="rightPanel">
          <div className="no-payment-party-state">
            <div className="no-payment-party-header">
              <div className="no-payment-party-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                </svg>
              </div>
              <div>
                <div className="no-payment-party-title">No unmatched payments for {partyFilter.party}</div>
                <div className="no-payment-party-sub">
                  Select a payment from the left panel, or review the outstanding invoices below.
                </div>
              </div>
            </div>
            {loadingInvoices ? (
              <div className="no-payment-inv-loading">Loading invoices…</div>
            ) : invoices.length > 0 ? (
              <div className="no-payment-inv-list">
                <div className="no-payment-inv-count">{invoices.length} outstanding invoice{invoices.length !== 1 ? 's' : ''}</div>
                {invoices.map((inv) => {
                  const typeLabel = (inv.invoice_type || '')
                    .replace('Sales Invoice', 'SI')
                    .replace('Purchase Invoice', 'PI')
                    .replace('Journal Entry', 'JV');
                  const cur = inv.currency || '';
                  const outAmt = inv.outstanding != null ? inv.outstanding : inv.outstanding_amount ?? 0;
                  const fmtAmt = (n) => fmt(n, cur, currencySymbols, currencySymbolOnRight);
                  const openUrl = `/app/${(inv.invoice_type || 'Sales Invoice').toLowerCase().replace(/ /g, '-')}/${inv.id}`;
                  return (
                    <div key={inv.id} className="no-payment-inv-row">
                      <div className="no-payment-inv-left">
                        <a href={openUrl} target="_blank" rel="noopener noreferrer" className="no-payment-inv-id">{inv.id}</a>
                        <span className="inv-type">{typeLabel}</span>
                        {inv.posting_date && <span className="inv-posting">{fmtDate(inv.posting_date)}</span>}
                        {inv.overdue && <span className="inv-due overdue">Overdue</span>}
                      </div>
                      <span className="no-payment-inv-amt">{fmtAmt(outAmt)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="no-payment-inv-loading">No outstanding invoices found.</div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="right" id="rightPanel">
        <div className="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--matcha-mid)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 7h12M8 12h12M8 17h12M3 7h.01M3 12h.01M3 17h.01"/>
          </svg>
          <div className="empty-text">Select a payment</div>
          <div className="empty-sub">Choose from the list to begin matching</div>
        </div>
      </div>
    );
  }

  const amtCls = p.dir === 'out' ? 'out' : '';
  const pfx = p.dir === 'out' ? '−' : '+';
  const selCount = selectedPayIds.length || 1;
  const totalAmt = selCount > 1 ? selectedPaymentsTotal() : p.amount;

  const summaryMeta =
    selCount > 1
      ? `${selCount} payments · Total ${pfx}${fmt(totalAmt, p.currency, currencySymbols, currencySymbolOnRight)}`
      : `${p.date || ''} \u00a0·\u00a0 ${p.note || ''} \u00a0·\u00a0 ${p.id || ''}`;

  const partyInvs = getPaymentInvoices();
  const partyOutstanding = partyInvs.reduce(
    (s, inv) =>
      s +
      (inv.outstanding_amount !== undefined ? inv.outstanding_amount : inv.amount || 0),
    0
  );

  const fmtAmt = (n) => fmt(n, p.currency, currencySymbols, currencySymbolOnRight);

  // Multi-payment bar
  let barHtml = null;
  if (selCount > 1 && totalAmt > 0) {
    const segs = selectedPayIds
      .map((pid) => getPayByKey(pid))
      .filter(Boolean)
      .map((pay) => ({
        id: pay.id,
        amount: roundCurrency(pay.amount || 0),
        date: pay.date,
        note: pay.note || '',
      }));
    barHtml = (
      <div className="pay-bar-wrap">
        <div className="pay-bar-label">Payments</div>
        <div className="pay-bar">
          {segs.map((s, i) => {
            const pct = Math.max(0, (s.amount / totalAmt) * 100);
            const bg = BAR_PALETTE[i % BAR_PALETTE.length];
            return (
              <div
                key={i}
                className="pay-bar-seg"
                style={{ width: pct + '%', background: bg }}
              >
                <span className="pay-bar-tt">
                  <strong>{pfx}{fmtAmt(s.amount)}</strong>
                  <span>{s.date || ''}</span>
                  <span> {s.note || s.id || ''}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const allInvs = getPaymentInvoices();
  const filteredInvs = applyInvoiceFilters(allInvs);
  const sameCo = filteredInvs.filter((i) => !i.xco);
  const xcoCo = filteredInvs.filter((i) => i.xco);
  const hasFilter = !!(invoiceSearchQ || invoiceFromDate || invoiceToDate);
  const noInvMsg = allInvs.length === 0
    ? 'No open invoices for this party'
    : 'No invoices match the filter';

  const sameCoTotal = sameCo.reduce(
    (s, i) => s + (i.outstanding_amount !== undefined ? i.outstanding_amount : i.amount || 0),
    0
  );
  const xcoCoTotal = xcoCo.reduce(
    (s, i) => s + (i.outstanding_amount !== undefined ? i.outstanding_amount : i.amount || 0),
    0
  );

  return (
    <div className="right" id="rightPanel">
      {/* Payment summary header */}
      <div className="pay-detail">
        <div className="pd-left">
          <div className={'pd-amount ' + amtCls}>
            {pfx}{selCount > 1 ? fmtAmt(totalAmt) : fmtAmt(p.amount)}
          </div>
          <div className="pd-party">{p.party || ''}</div>
          <div className="pd-meta">{summaryMeta}</div>
          {(selCount > 1 || (partyOutstanding !== 0 && partyInvs.length > 0)) && (
            <div className="pd-meta" style={{ marginTop: 4 }}>
              Outstanding {fmtAmt(partyOutstanding)}
            </div>
          )}
          {barHtml}
          {p.xco && (
            <div className="pd-xco-note">
              Received in Digicom {p.company} — invoice in another entity. Auto-JV will be posted.
            </div>
          )}
        </div>
      </div>

      {/* Invoice workspace */}
      <div className="workspace" id="workspace">
        {/* Invoice filters */}
        <div className="inv-filters">
          <input
            type="text"
            id="invSearch"
            className="inv-filter-search"
            placeholder="Search by invoice no."
            value={invoiceSearchQ}
            onChange={(e) => setInvoiceSearchQ(e.target.value)}
          />
          <span className="inv-filter-date-label">Posting date</span>
          <input
            type="date"
            id="invFromDate"
            className="inv-filter-date"
            title="From date"
            value={invoiceFromDate}
            onChange={(e) => setInvoiceFromDate(e.target.value)}
          />
          <span className="inv-filter-date-arrow">→</span>
          <input
            type="date"
            id="invToDate"
            className="inv-filter-date"
            title="To date"
            value={invoiceToDate}
            onChange={(e) => setInvoiceToDate(e.target.value)}
          />
          {hasFilter && (
            <button
              type="button"
              className="inv-filter-clear"
              onClick={() => {
                setInvoiceSearchQ('');
                setInvoiceFromDate('');
                setInvoiceToDate('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Select all / Clear actions */}
        {filteredInvs.length > 0 && (
          <div className="ws-actions">
            <span className="ws-action" onClick={selectAllInvoices}>Select all</span>
            <span
              className="ws-action"
              onClick={(e) => { clearTray(); e.stopPropagation(); }}
            >
              Clear
            </span>
          </div>
        )}

        {/* Invoice list */}
        {loadingInvoices ? (
          <div className="ws-label">Loading invoices…</div>
        ) : filteredInvs.length === 0 ? (
          <div className="ws-label">{noInvMsg}</div>
        ) : (
          <div className="workspace-scroll">
            {sameCo.length > 0 && (
              <Section
                label={`This company — ${p.company}`}
                invoices={sameCo}
                total={sameCoTotal}
                activePay={p}
                sectionClass="section-same"
                fmtAmt={fmtAmt}
                loadMoreInvoices={loadMoreInvoices}
                loadingMoreInvoices={loadingMoreInvoices}
                invoicesHasMore={invoicesHasMore}
              />
            )}
            {xcoCo.length > 0 && (() => {
              // Group xco invoices by company so each gets its own labelled section
              const xcoByCompany = xcoCo.reduce((acc, inv) => {
                const co = inv.company || 'Other';
                if (!acc[co]) acc[co] = [];
                acc[co].push(inv);
                return acc;
              }, {});
              return Object.entries(xcoByCompany).map(([co, invs]) => {
                const coTotal = invs.reduce(
                  (s, i) => s + (i.outstanding_amount !== undefined ? i.outstanding_amount : i.amount || 0),
                  0
                );
                return (
                  <Section
                    key={co}
                    label={`${co} — intercompany transfer via JV`}
                    invoices={invs}
                    total={coTotal}
                    activePay={p}
                    sectionClass="section-xco"
                    fmtAmt={fmtAmt}
                    loadMoreInvoices={loadMoreInvoices}
                    loadingMoreInvoices={loadingMoreInvoices}
                    invoicesHasMore={invoicesHasMore}
                    defaultCollapsed={true}
                  />
                );
              });
            })()}
          </div>
        )}
      </div>

      {/* Allocation Tray */}
      <Tray activePay={p} />
    </div>
  );
}

function Section({ label, invoices, total, activePay, sectionClass, fmtAmt, loadMoreInvoices, loadingMoreInvoices, invoicesHasMore, defaultCollapsed }) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  const cur = activePay?.currency || '';

  return (
    <div className={`section ${sectionClass}${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="section-head"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="section-chevron">{collapsed ? '▶' : '▼'}</span>
        <span className="section-label">{label}</span>
        <span className="section-summary">{invoices.length} invoices · {fmtAmt(total)}</span>
        <span className="section-line"></span>
      </button>
      {!collapsed && (
        <SectionBody
          invoices={invoices}
          activePay={activePay}
          loadMoreInvoices={loadMoreInvoices}
          loadingMoreInvoices={loadingMoreInvoices}
          invoicesHasMore={invoicesHasMore}
        />
      )}
    </div>
  );
}

function SectionBody({ invoices, activePay, loadMoreInvoices, loadingMoreInvoices, invoicesHasMore }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function onScroll() {
      if (loadingMoreInvoices || !invoicesHasMore) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        loadMoreInvoices();
      }
    }
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [loadingMoreInvoices, invoicesHasMore, loadMoreInvoices]);

  return (
    <div className="section-body" ref={ref}>
      {invoices.map((inv) => (
        <InvoiceRow key={inv.id} inv={inv} activePay={activePay} />
      ))}
      {loadingMoreInvoices && (
        <div style={{ padding: '8px', textAlign: 'center', fontSize: 12, color: 'var(--t3)' }}>
          Loading more…
        </div>
      )}
    </div>
  );
}

