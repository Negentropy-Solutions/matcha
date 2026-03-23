import React, { useState } from 'react';
import { useAppStore } from '../../store';
import { fmt, roundCurrency } from '../../lib/format';

export default function Tray({ activePay }) {
  const {
    allocations,
    selectedPayIds,
    trayExpanded,
    setTrayExpanded,
    invoices,
    invFxMap,
    fxVersion,
    clearTray,
    doReconcile,
    showXcoModal,
    allocTotal,
    selectedPaymentsTotal,
    currencySymbols,
    currencySymbolOnRight,
    companyCurrency,
  } = useAppStore();

  const p = activePay;
  if (!p) return null;

  const hasAlloc = Object.keys(allocations).length > 0;
  const total = allocTotal();
  const payTotal = selectedPayIds.length ? selectedPaymentsTotal() : roundCurrency(p.amount || 0);
  const diff = roundCurrency(payTotal - total);

  const hasXco = Object.keys(allocations).some((id) => {
    const inv = invoices.find((i) => i.id === id);
    return inv && inv.xco;
  });

  const cur = typeof p.currency === 'string' ? p.currency : '';
  const fmtAmt = (n) => fmt(n, cur, currencySymbols, currencySymbolOnRight);

  let balHtml = null;
  let showReconcile = false;
  if (hasAlloc) {
    if (Math.abs(diff) < 1) {
      balHtml = <div className="balance-indicator bal-ok">Balanced</div>;
      showReconcile = true;
    } else if (diff > 0) {
      balHtml = <div className="balance-indicator bal-partial">{fmtAmt(diff)} remaining</div>;
      showReconcile = true;
    } else {
      balHtml = <div className="balance-indicator bal-ok">Balanced</div>;
      showReconcile = true;
    }
  }

  const allocCount = Object.keys(allocations).length;
  const compactLine = hasAlloc
    ? `${allocCount} invoice${allocCount !== 1 ? 's' : ''} · ${fmtAmt(total)} allocated`
    : '';

  // Total FX gain/loss across all allocated invoices (always in company currency)
  const fxCurGlobal = companyCurrency || cur;
  const totalFx = hasAlloc
    ? Object.keys(allocations).reduce((sum, id) => {
        const fx = invFxMap[id] != null ? parseFloat(invFxMap[id]) : 0;
        return sum + fx;
      }, 0)
    : 0;
  const fxSummary =
    Math.abs(totalFx) >= 1e-6 ? (
      <span
        className={
          'inv-fx-badge ' + (totalFx > 0 ? 'inv-fx-badge-gain' : 'inv-fx-badge-loss')
        }
        title="Estimated FX gain/loss on reconciliation"
      >
        {totalFx > 0 ? 'FX gain ' : 'FX loss '}
        {fmt(Math.abs(totalFx), fxCurGlobal, currencySymbols, currencySymbolOnRight)}
      </span>
    ) : null;

  const xcoHint = hasAlloc && hasXco
    ? <div className="tray-xco-hint">Auto-JV will be posted</div>
    : null;

  const listItems = hasAlloc
    ? Object.keys(allocations).map((id) => {
        const inv = invoices.find((i) => i.id === id);
        const party = (inv?.party) || (inv?.customer) || '';
        const amt = fmtAmt(allocations[id]);
        const fxVal = invFxMap[id] != null ? parseFloat(invFxMap[id]) : null;
        // FX gain/loss is always in company base currency, not invoice/payment currency
        const fxCur = companyCurrency || cur;
        const fxBadge =
          fxVal != null && isFinite(fxVal) && Math.abs(fxVal) >= 1e-6 ? (
            <span
              className={
                'inv-fx-badge tray-line-fx ' +
                (fxVal > 0 ? 'inv-fx-badge-gain' : 'inv-fx-badge-loss')
              }
            >
              {fxVal > 0 ? 'FX gain ' : 'FX loss '}
              {fmt(Math.abs(fxVal), fxCur, currencySymbols, currencySymbolOnRight)}
            </span>
          ) : null;

        return (
          <div key={id} className="tray-math-row">
            <span className="tray-math-plus">+</span>
            <div className="tray-math-detail">
              <span className="tray-list-item-id">{id}</span>
              {party && <span className="tray-list-item-party">{party}</span>}
            </div>
            <span className="tray-math-amt">{amt}</span>
            {fxBadge}
          </div>
        );
      })
    : null;

  const expandedClass = hasAlloc && trayExpanded ? ' tray-expanded' : '';

  const [reconciling, setReconciling] = useState(false);

  function handleReconcile() {
    setReconciling(true);
    doReconcile(
      null,
      () => setReconciling(false)
    );
  }

  return (
    <div className={'tray' + expandedClass}>
      <div className="tray-info">
        <div className="tray-row">
          {!hasAlloc ? (
            <span className="tray-empty-msg">Select invoices to allocate</span>
          ) : (
            <button
              type="button"
              className="tray-summary-head"
              onClick={() => setTrayExpanded(!trayExpanded)}
              title="Expand to see allocated invoices"
            >
              <span className="tray-chevron">&#9654;</span>
              <span className="tray-compact">
                <strong>{compactLine}</strong>
              </span>
            </button>
          )}
          {balHtml}
          {fxSummary}
          {xcoHint}
        </div>
        {hasAlloc && (
          <div className="tray-list">
            {listItems}
            <div className="tray-math-rule"></div>
            <div className="tray-math-total">
              <span className="tray-math-total-label">Total allocated</span>
              <span className="tray-math-total-amt">{fmtAmt(total)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="tray-right">
        {showReconcile && (
          <button
            className="btn btn-primary"
            disabled={reconciling}
            onClick={hasXco ? showXcoModal : handleReconcile}
          >
            {reconciling ? 'Reconciling…' : 'Reconcile'}
          </button>
        )}
      </div>
    </div>
  );
}

