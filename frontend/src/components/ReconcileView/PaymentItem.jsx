import { useAppStore } from '../../store';
import { fmt, fmtDate, appUrl } from '../../lib/format';

const OPEN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17L17 7"/>
    <path d="M17 7h-6M17 7v6"/>
  </svg>
);

export default function PaymentItem({ pay, isActive, isSelected }) {
  const { selectPayment, payKey, currencySymbols, currencySymbolOnRight } = useAppStore();
  const key = payKey(pay);

  const amtCls = pay.dir === 'out' ? 'out' : '';
  const pfx = pay.dir === 'out' ? '−' : '+';
  const dateStr = fmtDate(pay.date) || pay.date || '';

  const xcoDot = pay.xco ? <span className="pi-xco-mark">XCO</span> : null;
  const jvBadge = pay.reference_type === 'Journal Entry'
    ? <span className="pi-jv-badge">JV</span>
    : null;
  const pt = (pay.party_type || '');
  const ptShort = pt ? pt.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() : '';
  const ptBadge = ptShort
    ? <span className="pi-pt-badge" title={pt}>{ptShort}</span>
    : null;

  const payOpenUrl = appUrl(pay.reference_type || 'Payment Entry', pay.id);

  function handleClick(e) {
    selectPayment(key, e);
  }

  return (
    <div
      className={'pay-item' + (isActive ? ' active' : '') + (isSelected ? ' selected' : '')}
      onClick={handleClick}
    >
      <div className="pi-body">
        <div className="pi-top">
          <div className="pi-party">
            {ptBadge}{jvBadge}{xcoDot}{pay.party || ''}
          </div>
          <div className={'pi-amount ' + amtCls}>
            {pfx}{fmt(pay.amount, pay.currency, currencySymbols, currencySymbolOnRight)}
          </div>
        </div>
        <div className="pi-sub">
          <span>{dateStr}</span>
          <span className="pi-id-wrap" style={{ color: 'var(--t4)' }}>
            <span>{pay.id || ''}</span>
            <a
              href={payOpenUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="open-new-tab-btn pi-open-inline"
              onClick={(e) => e.stopPropagation()}
              title="Open in new tab"
            >
              {OPEN_ICON}
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}
