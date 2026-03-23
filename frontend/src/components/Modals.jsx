import { useAppStore } from '../store';
import { fmt, appUrl } from '../lib/format';
import { useMemo } from 'react';

// ── Cross-company (XCO) modal ──────────────────────────────────
export function XcoModal() {
  const { xcoModal, setXcoModal, currencySymbols, currencySymbolOnRight, companyCurrency, doReconcile } = useAppStore();
  const {
    open,
    from,
    dest,
    total,
    currency,
    jvRows = [],
    hasSameCompany,
    sameCompanyAmount,
    onConfirm,
    reconciling,
  } = xcoModal;

  function close() { setXcoModal((m) => ({ ...m, open: false })); }

  // Format per-row using that row's own currency (account currency), falling
  // back to payment currency; FX rows use company base currency.
  const fmtRow = (n, cur, isFx) =>
    fmt(
      n,
      isFx ? (companyCurrency || cur || currency) : (cur || currency),
      currencySymbols,
      currencySymbolOnRight
    );

  // Detect if any row has an FX note (means multi-currency scenario).
  const hasFx = useMemo(() => jvRows.some((r) => r.note), [jvRows]);

  return (
    <div className={'overlay' + (open ? ' open' : '')}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">Cross-company reconciliation</div>
          <button className="modal-x" onClick={close}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 10, lineHeight: 1.6 }}>
            This payment was received in{' '}
            <strong style={{ color: 'var(--text)' }}>{from}</strong>.
            {hasSameCompany ? (
              <>
                {' '}It will reconcile{' '}
                <strong style={{ color: 'var(--text)' }}>
                  {fmtRow(sameCompanyAmount || 0, currency, false)}
                </strong>{' '}
                against invoices in {from}, and the remaining balance will be transferred
                to{' '}
                <strong style={{ color: 'var(--text)' }}>{dest}</strong> via intercompany
                Journal Vouchers.
              </>
            ) : (
              <>
                {' '}The invoice belongs to{' '}
                <strong style={{ color: 'var(--text)' }}>{dest}</strong>. Matcha will post
                the intercompany Journal Vouchers automatically.
              </>
            )}
          </p>
          {hasSameCompany && (
            <p style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.5 }}>
              The table below shows only the <strong>intercompany</strong> part of this
              reconciliation. Same-company allocations will be handled by the normal
              payment reconciliation flow.
            </p>
          )}
          <table className="jv-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Dr / Cr</th>
                <th>Account</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {jvRows.map((row, i) => (
                <tr key={i} className={row.note ? 'jv-fx-row' : ''}>
                  <td>{row.company}</td>
                  <td className={row.dr === 'Dr' ? 'jv-dr' : 'jv-cr'}>{row.dr}</td>
                  <td>{row.account}{row.note ? <span className="jv-fx-note"> ({row.note})</span> : null}</td>
                  <td>{fmtRow(row.amt, row.currency, !!row.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="jv-note">
            Both JVs will be submitted and linked to this payment and invoice automatically. No manual entry needed.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={close} disabled={reconciling}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={reconciling}
            onClick={() => {
              if (onConfirm) {
                onConfirm();
                return;
              }
              // Fallback: run reconcile from here so the dialog behaves like the tray button
              setXcoModal((m) => ({ ...m, reconciling: true }));
              doReconcile(
                null,
                () => setXcoModal((m) => ({ ...m, open: false, reconciling: false }))
              );
            }}
          >
            {reconciling ? 'Posting…' : 'Post JVs & Reconcile'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Undo reconciliation modal ──────────────────────────────────
export function UndoModal() {
  const { undoModal, setUndoModal, confirmUndo } = useAppStore();
  const { open, description, confirming } = undoModal;

  function close() { setUndoModal({ open: false, logName: null, description: '' }); }

  return (
    <div className={'overlay' + (open ? ' open' : '')}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">Undo reconciliation?</div>
          <button className="modal-x" onClick={close}>&#215;</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', margin: '0 0 10px 0' }}>
            {description}
          </p>
          <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, margin: 0 }}>
            Payments will be unlinked from the invoices. You can reconcile again later if needed.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn btn-primary" disabled={confirming} onClick={confirmUndo}>
            {confirming ? 'Undoing…' : 'Undo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History view modal ─────────────────────────────────────────
export function HistoryViewModal() {
  const { historyViewModal, setHistoryViewModal, currencySymbols, currencySymbolOnRight, companyCurrency } = useAppStore();
  const { open, party, currency, allocs } = historyViewModal;

  function close() {
    setHistoryViewModal({ open: false, party: '', currency: '', allocs: [] });
  }

  const fmtAmt = (n) => fmt(n, currency, currencySymbols, currencySymbolOnRight);
  const fmtBase = (n) => fmt(n, companyCurrency || currency, currencySymbols, currencySymbolOnRight);
  const total = (allocs || []).reduce((s, a) => s + (parseFloat(a.allocated_amount) || 0), 0);
  const totalFx = (allocs || []).reduce((s, a) => s + (parseFloat(a.fx_gain_loss || a.difference_amount) || 0), 0);

  const hasXco = (allocs || []).some((a) => a.invoice_company || a.jv_payment_company);
  const hasFx = (allocs || []).some((a) => Math.abs(parseFloat(a.fx_gain_loss || a.difference_amount) || 0) > 1e-6);

  const subtitle = party
    ? `${party} · ${(allocs || []).length} allocation${(allocs || []).length !== 1 ? 's' : ''}`
    : 'Allocation details';

  const DocLink = ({ type, name, label }) =>
    name ? (
      <a href={appUrl(type, name)} target="_blank" rel="noopener noreferrer" className="history-view-doc-link">
        {label || name}
      </a>
    ) : '—';

  return (
    <div className={'overlay' + (open ? ' open' : '')}>
      <div className="modal modal-wide">
        <div className="modal-head">
          <div className="modal-title">Reconciliation details</div>
          <button className="modal-x" onClick={close}>&#215;</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', margin: '0 0 10px 0' }}>
            {subtitle}
          </p>
          {(!allocs || !allocs.length) ? (
            <p style={{ fontSize: 12, color: 'var(--t3)', margin: 0 }}>No allocation details.</p>
          ) : (
            <div className="undo-modal-details history-view-tray">
              <table className="undo-detail-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    {hasXco && <th>Company</th>}
                    <th>Against</th>
                    {hasXco && <th>Via JV</th>}
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    {hasFx && <th style={{ textAlign: 'right' }}>FX</th>}
                  </tr>
                </thead>
                <tbody>
                  {(allocs || []).map((a, i) => {
                    const invType = a.invoice_type || 'Sales Invoice';
                    const vType = a.voucher_type || 'Payment Entry';
                    const isXco = !!(a.invoice_company || a.jv_payment_company);
                    const fxVal = parseFloat(a.fx_gain_loss || a.difference_amount) || 0;
                    return (
                      <tr key={i} className={isXco ? 'history-xco-row' : ''}>
                        <td className="col-invoice">
                          <DocLink type={invType} name={a.invoice_number} />
                        </td>
                        {hasXco && (
                          <td className="col-company">
                            {isXco
                              ? <span className="co-badge co-badge-xco">{a.invoice_company}</span>
                              : <span className="co-badge co-badge-same">same</span>
                            }
                          </td>
                        )}
                        <td className="col-against">
                          {isXco ? (
                            // XCO: "against" is the payment entry (settled via JVs)
                            <>
                              Payment Entry{' '}
                              <DocLink type="Payment Entry" name={a.payment_name} />
                            </>
                          ) : (
                            <>
                              {vType}{' '}
                              <DocLink type={vType} name={a.payment_name} />
                            </>
                          )}
                        </td>
                        {hasXco && (
                          <td className="col-jv">
                            {isXco ? (
                              <span className="history-jv-links">
                                <DocLink type="Journal Entry" name={a.jv_payment_company} label="JV (pay co)" />
                                {a.jv_invoice_company && (
                                  <>{' · '}<DocLink type="Journal Entry" name={a.jv_invoice_company} label="JV (inv co)" /></>
                                )}
                              </span>
                            ) : '—'}
                          </td>
                        )}
                        <td className="col-amount" style={{ textAlign: 'right' }}>
                          {fmtAmt(a.allocated_amount || 0)}
                        </td>
                        {hasFx && (
                          <td className="col-fx" style={{ textAlign: 'right' }}>
                            {Math.abs(fxVal) > 1e-6 ? (
                              <span className={fxVal > 0 ? 'inv-fx-badge inv-fx-badge-gain' : 'inv-fx-badge inv-fx-badge-loss'}>
                                {fxVal > 0 ? '+' : ''}{fmtBase(fxVal)}
                              </span>
                            ) : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="undo-detail-total-row">
                    {/* Span all non-amount columns so the total amount aligns under the Amount column */}
                    <td colSpan={hasXco ? 4 : 2} className="tray-math-total-label">Total allocated</td>
                    <td className="col-amount tray-math-total-amt" style={{ textAlign: 'right' }}>{fmtAmt(total)}</td>
                    {hasFx && (
                      <td className="col-fx" style={{ textAlign: 'right' }}>
                        {Math.abs(totalFx) > 1e-6 ? (
                          <span className={totalFx > 0 ? 'inv-fx-badge inv-fx-badge-gain' : 'inv-fx-badge inv-fx-badge-loss'}>
                            {totalFx > 0 ? '+' : ''}{fmtBase(totalFx)}
                          </span>
                        ) : null}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
