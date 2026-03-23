import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { fmt, appUrl } from '../lib/format';

function ExceptionPaymentCard({ item, onReconcile }) {
  const { currencySymbols, currencySymbolOnRight } = useAppStore();
  const ageDays = typeof item.age_days === 'number' ? item.age_days : 0;
  const ageCls =
    ageDays >= 60 ? 'exc-age-critical' : ageDays >= 30 ? 'exc-age-warn' : '';
  const ageStr = ageDays + ' day' + (ageDays !== 1 ? 's' : '');
  const amount = parseFloat(item.amount) || 0;
  const isReceive = (item.payment_type || '').toLowerCase() === 'receive';
  const amtCls = isReceive ? 'exc-amt-credit' : 'exc-amt-debit';
  const amtStr =
    (amount < 0 ? '−' : '') +
    fmt(Math.abs(amount), item.currency || '', currencySymbols, currencySymbolOnRight);
  const pt = item.party_type || '';
  const ptShort = pt ? pt.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() : '';
  const viewUrl = appUrl(item.doctype || 'Payment Entry', item.name);

  return (
    <div className="exc-card">
      <div className="exc-card-left">
        <div className="exc-inv-badges">
          {ptShort && (
            <span className="pi-pt-badge" title={pt}>
              {ptShort}
            </span>
          )}
        </div>
        <div className="exc-card-id">{item.name || ''}</div>
        <div className="exc-card-party">{item.party || ''}</div>
        <div className="exc-card-meta">
          <span className={'exc-card-age ' + ageCls}>{ageStr}</span>
        </div>
      </div>
      <div className="exc-card-right">
        <span className={'exc-card-amt ' + amtCls}>{amtStr}</span>
        <div className="exc-card-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onReconcile(item)}
          >
            Reconcile
          </button>
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="exc-view-link"
          >
            View
          </a>
        </div>
      </div>
    </div>
  );
}

function ExceptionInvoiceCard({ item, onReconcile }) {
  const { currencySymbols, currencySymbolOnRight } = useAppStore();
  const ageDays = typeof item.age_days === 'number' ? item.age_days : 0;
  const ageCls =
    ageDays >= 90 ? 'exc-age-critical' : ageDays >= 60 ? 'exc-age-warn' : '';
  const ageStr = ageDays + ' day' + (ageDays !== 1 ? 's' : '');
  const amount = parseFloat(item.amount) || 0;
  const isSI = (item.doctype || '') === 'Sales Invoice';
  const amtCls = isSI ? 'exc-amt-credit' : 'exc-amt-debit';
  const amtStr =
    (amount < 0 ? '−' : '') +
    fmt(Math.abs(amount), item.currency || '', currencySymbols, currencySymbolOnRight);
  const isReturn = item.is_return === 1 || item.is_return === true;
  const pt = item.party_type || '';
  const ptShort = pt ? pt.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() : '';
  const viewUrl = appUrl(item.doctype || 'Sales Invoice', item.name);

  return (
    <div className="exc-card">
      <div className="exc-card-left">
        <div className="exc-inv-badges">
          {ptShort && (
            <span className="pi-pt-badge" title={pt}>
              {ptShort}
            </span>
          )}
          <span className={'exc-inv-badge ' + (isSI ? 'exc-badge-si' : 'exc-badge-pi')}>
            {isSI ? 'SI' : 'PI'}
          </span>
          {isReturn && (
            <span className={'exc-inv-badge ' + (isSI ? 'exc-badge-cn' : 'exc-badge-dn')}>
              {isSI ? 'CN' : 'DN'}
            </span>
          )}
        </div>
        <div className="exc-card-id">{item.name || ''}</div>
        <div className="exc-card-party">{item.party || ''}</div>
        <div className="exc-card-meta">
          <span className={'exc-card-age ' + ageCls}>{ageStr}</span>
        </div>
      </div>
      <div className="exc-card-right">
        <span className={'exc-card-amt ' + amtCls}>{amtStr}</span>
        <div className="exc-card-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onReconcile(item)}
          >
            Reconcile
          </button>
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="exc-view-link"
          >
            View
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ExceptionsView({ visible }) {
  const {
    exceptionsLoading,
    exceptionsPayments,
    exceptionsInvoices,
    exceptionsTotalPayments,
    exceptionsTotalInvoices,
    exceptionsTotalInSystem,
    exceptionsPaymentsPage,
    exceptionsInvoicesPage,
    exceptionsSearchPayments,
    setExceptionsSearchPayments,
    exceptionsSearchInvoices,
    setExceptionsSearchInvoices,
    exceptionsPaySummary,
    exceptionsSiSummary,
    exceptionsPiSummary,
    exceptionsLimit,
    loadExceptions,
    goToReconcileForPayment,
    goToReconcileForInvoice,
    currentCompany,
  } = useAppStore();

  const paySearchTimerRef = useRef(null);
  const invSearchTimerRef = useRef(null);

  // Load when the tab becomes visible.
  // If App.jsx already pre-fetched on startup (data present), just mark loaded
  // so we don't double-fetch.
  const hasLoaded = useRef(false);
  useEffect(() => {
    if (visible && !hasLoaded.current) {
      hasLoaded.current = true;
      if (!exceptionsPayments.length && !exceptionsInvoices.length && !exceptionsTotalInSystem) {
        loadExceptions(1, 1);
      }
    }
  }, [visible]); // eslint-disable-line

  function handlePaySearch(val) {
    setExceptionsSearchPayments((val || '').trim());
    if (paySearchTimerRef.current) clearTimeout(paySearchTimerRef.current);
    paySearchTimerRef.current = setTimeout(() => {
      paySearchTimerRef.current = null;
      loadExceptions(1, null, 'payments');
    }, 350);
  }

  function handleInvSearch(val) {
    setExceptionsSearchInvoices((val || '').trim());
    if (invSearchTimerRef.current) clearTimeout(invSearchTimerRef.current);
    invSearchTimerRef.current = setTimeout(() => {
      invSearchTimerRef.current = null;
      loadExceptions(null, 1, 'invoices');
    }, 350);
  }

  const payTotalPages = Math.max(1, Math.ceil(exceptionsTotalPayments / exceptionsLimit));
  const invTotalPages = Math.max(1, Math.ceil(exceptionsTotalInvoices / exceptionsLimit));

  const offsetPayments = (exceptionsPaymentsPage - 1) * exceptionsLimit;
  const offsetInvoices = (exceptionsInvoicesPage - 1) * exceptionsLimit;

  const payFrom = exceptionsTotalPayments === 0 ? 0 : offsetPayments + 1;
  const payTo = offsetPayments + exceptionsPayments.length;
  const payMeta =
    exceptionsTotalPayments <= exceptionsLimit && exceptionsPaymentsPage === 1
      ? `${exceptionsTotalPayments} payment${exceptionsTotalPayments !== 1 ? 's' : ''}`
      : `Showing ${payFrom}–${payTo} of ${exceptionsTotalPayments}`;

  const invFrom = exceptionsTotalInvoices === 0 ? 0 : offsetInvoices + 1;
  const invTo = offsetInvoices + exceptionsInvoices.length;
  const invMeta =
    exceptionsTotalInvoices <= exceptionsLimit && exceptionsInvoicesPage === 1
      ? `${exceptionsTotalInvoices} invoice${exceptionsTotalInvoices !== 1 ? 's' : ''}`
      : `Showing ${invFrom}–${invTo} of ${exceptionsTotalInvoices}`;

  const noCompany = !currentCompany;
  const isEmpty = !exceptionsLoading && exceptionsTotalInSystem === 0;

  return (
    <div className="matcha-app exceptions-view" style={visible ? {} : { display: 'none' }}>
      <div className="exceptions-full">
        <div className="exceptions-hero">
          <div className="exceptions-hero-text">
            <h2 className="exceptions-title">Exceptions</h2>
            <p className="exceptions-desc">
              Unmatched payments and ageing invoices that need attention. Fix them
              before they become a problem.
            </p>
          </div>
        </div>

        <div className="exceptions-content">
          {exceptionsLoading && (
            <div className="exceptions-loading">Loading exceptions…</div>
          )}

          {!exceptionsLoading && noCompany && (
            <div className="exceptions-empty">
              <div className="exceptions-empty-icon">✓</div>
              <div className="exceptions-empty-title">No company selected</div>
              <div className="exceptions-empty-desc">
                Select a company to see exceptions.
              </div>
            </div>
          )}

          {!exceptionsLoading && !noCompany && isEmpty && (
            <div className="exceptions-empty">
              <div className="exceptions-empty-icon">✓</div>
              <div className="exceptions-empty-title">No exceptions</div>
              <div className="exceptions-empty-desc">
                All clear. Unmatched payments and ageing invoices will appear here.
              </div>
            </div>
          )}

          {!exceptionsLoading && !noCompany && !isEmpty && (
            <div className="exceptions-sections">
              <div className="exceptions-two-col">
                {/* Payments column */}
                <div className="exceptions-col exc-col-payments">
                  <div className="exceptions-col-header">
                    <div className="exceptions-col-title">Unmatched payments</div>
                    <div className="exceptions-col-summary">{exceptionsPaySummary}</div>
                    <div className="exceptions-col-toolbar">
                      <div className="search">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                        <input
                          type="text"
                          placeholder="Search party…"
                          value={exceptionsSearchPayments}
                          onChange={(e) => handlePaySearch(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => loadExceptions(1, null, 'payments')}
                        title="Reload"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                  <div className="exceptions-col-scroll">
                    <div className="exceptions-cards">
                      {exceptionsPayments.map((item) => (
                        <ExceptionPaymentCard
                          key={item.name}
                          item={item}
                          onReconcile={goToReconcileForPayment}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="exceptions-col-footer">
                    <span className="exceptions-col-meta">{payMeta}</span>
                    <div className="exceptions-col-pagination">
                      <button
                        type="button"
                        className="exc-col-page-btn"
                        disabled={exceptionsPaymentsPage <= 1}
                        onClick={() =>
                          loadExceptions(exceptionsPaymentsPage - 1, null, 'payments')
                        }
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="exc-col-page-btn"
                        disabled={exceptionsPaymentsPage >= payTotalPages}
                        onClick={() =>
                          loadExceptions(exceptionsPaymentsPage + 1, null, 'payments')
                        }
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>

                {/* Invoices column */}
                <div className="exceptions-col exc-col-invoices">
                  <div className="exceptions-col-header">
                    <div className="exceptions-col-title">Ageing invoices</div>
                    <div className="exceptions-col-summary exc-summary-inline">
                      <span className="exc-summary-line">
                        <span className="exc-badge-header exc-badge-si">SI</span>
                        <span>{exceptionsSiSummary}</span>
                      </span>
                      <span className="exc-summary-line">
                        <span className="exc-badge-header exc-badge-pi">PI</span>
                        <span>{exceptionsPiSummary}</span>
                      </span>
                    </div>
                    <div className="exceptions-col-toolbar">
                      <div className="search">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                        </svg>
                        <input
                          type="text"
                          placeholder="Search party…"
                          value={exceptionsSearchInvoices}
                          onChange={(e) => handleInvSearch(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => loadExceptions(null, 1, 'invoices')}
                        title="Reload"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                  <div className="exceptions-col-scroll">
                    <div className="exceptions-cards">
                      {exceptionsInvoices.map((item) => (
                        <ExceptionInvoiceCard
                          key={item.name}
                          item={item}
                          onReconcile={goToReconcileForInvoice}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="exceptions-col-footer">
                    <span className="exceptions-col-meta">{invMeta}</span>
                    <div className="exceptions-col-pagination">
                      <button
                        type="button"
                        className="exc-col-page-btn"
                        disabled={exceptionsInvoicesPage <= 1}
                        onClick={() =>
                          loadExceptions(null, exceptionsInvoicesPage - 1, 'invoices')
                        }
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="exc-col-page-btn"
                        disabled={exceptionsInvoicesPage >= invTotalPages}
                        onClick={() =>
                          loadExceptions(null, exceptionsInvoicesPage + 1, 'invoices')
                        }
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
