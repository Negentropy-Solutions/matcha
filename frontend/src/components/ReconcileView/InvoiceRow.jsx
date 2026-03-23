import { useAppStore } from '../../store';
import { fmt, fmtDate, invoiceOutstanding, appUrl, roundCurrency } from '../../lib/format';

const OPEN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17L17 7"/>
    <path d="M17 7h-6M17 7v6"/>
  </svg>
);

export default function InvoiceRow({ inv, activePay }) {
  const {
    allocations,
    selectedPayIds,
    invAgainstMap,
    invFxMap,
    fxVersion,
    toggleInvoice,
    updateAlloc,
    currencySymbols,
    currencySymbolOnRight,
    companyCurrency,
  } = useAppStore();

  const sel = allocations[inv.id] !== undefined;
  const isCross = !!inv.xco;

  const typeLabel = (inv.invoice_type || '')
    .replace('Sales Invoice', 'SI')
    .replace('Purchase Invoice', 'PI')
    .replace('Journal Entry', 'JV');

  const postingStr = inv.posting_date ? fmtDate(inv.posting_date) : '';
  const dueStr = inv.due ? fmtDate(inv.due) : '';
  const outAmt = invoiceOutstanding(inv);
  const allocAmt = sel ? roundCurrency(allocations[inv.id]) : roundCurrency(outAmt);

  const p = activePay;
  const cur = (typeof inv.currency === 'string' ? inv.currency : '')
    || (p && typeof p.currency === 'string' ? p.currency : '');

  const fmtAmt = (n) => fmt(n, cur, currencySymbols, currencySymbolOnRight);

  const coBadge = isCross
    ? <span className="co-badge co-badge-xco">{inv.company || ''}</span>
    : <span className="co-badge co-badge-same">{inv.company || ''}</span>;

  const openUrl = appUrl(inv.invoice_type || 'Sales Invoice', inv.id);
  const openBtn = (
    <a
      href={openUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="open-new-tab-btn inv-open-inline"
      onClick={(e) => e.stopPropagation()}
      title="Open in new tab"
    >
      {OPEN_ICON}
    </a>
  );

  const multiPay = selectedPayIds && selectedPayIds.length > 1;
  let againstBadge = null;
  if (sel && multiPay && invAgainstMap[inv.id]?.length) {
    const fullLabel = invAgainstMap[inv.id].join(', ');
    againstBadge = (
      <span className="inv-against-badge" title={`Adjusted against: ${fullLabel}`}>
        {fullLabel}
      </span>
    );
  }

  const fxAmt = sel && invFxMap[inv.id] != null && Math.abs(invFxMap[inv.id]) >= 1e-6
    ? invFxMap[inv.id]
    : null;

  // FX gain/loss is always in company currency (base currency), not invoice currency
  const fxCur = companyCurrency || cur;
  const fmtFx = (n) => fmt(n, fxCur, currencySymbols, currencySymbolOnRight);

  let fxLine = null;
  if (fxAmt != null) {
    const fxCls = fxAmt > 0 ? 'inv-fx-badge inv-fx-badge-gain' : 'inv-fx-badge inv-fx-badge-loss';
    fxLine = (
      <span className={fxCls}>
        {fxAmt > 0 ? 'FX gain ' : 'FX loss '}{fmtFx(Math.abs(fxAmt))}
      </span>
    );
  }

  const metaParts = [
    postingStr ? <span key="post" className="inv-posting">{postingStr}</span> : null,
    typeLabel ? <span key="type" className="inv-type">{typeLabel}</span> : null,
    inv.overdue
      ? <span key="due" className="inv-due overdue">Overdue</span>
      : dueStr
      ? <span key="due" className="inv-due">Due {dueStr}</span>
      : null,
  ].filter(Boolean);

  return (
    <div
      className={'inv-row ' + (sel ? 'selected' : '')}
      onClick={() => toggleInvoice(inv.id)}
    >
      <div className="inv-body">
        <div className="inv-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span className="inv-id-wrap">
              <span className="inv-ref">{inv.id}</span>
              {openBtn}
            </span>
            {coBadge}
          </div>
          <span className="inv-top-right">
            {againstBadge}
            {fxLine}
            <span className="inv-amount">{fmtAmt(outAmt)}</span>
          </span>
        </div>
        <div className="inv-meta">
          {metaParts.map((part, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: 'var(--border)' }}> · </span>}
              {part}
            </span>
          ))}
        </div>
        {isCross && (
          <div className="inv-xco-note">
            Invoice in {inv.company || ''} — intercompany JV posted automatically
          </div>
        )}
      </div>
      {sel && (
        <div className="inv-alloc" onClick={(e) => e.stopPropagation()}>
          <input
            className="alloc-input"
            type="number"
            value={allocAmt}
            min="1"
            onChange={(e) => updateAlloc(inv.id, e.target.value)}
          />
          <div className="alloc-note">allocated</div>
        </div>
      )}
    </div>
  );
}
