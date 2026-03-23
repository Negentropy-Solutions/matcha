import { useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { fmt } from '../../lib/format';
import PaymentItem from './PaymentItem';

export default function LeftPanel() {
  const {
    loadingPayments,
    dashboardStats,
    totalPaymentsCount,
    payments,
    activePayId,
    selectedPayIds,
    partyFilter,
    filterMode,
    setFilterMode,
    searchQ,
    filterPayments,
    selectAllPayments,
    clearPaymentSelection,
    clearPartyFilter,
    loadMorePayments,
    paymentsHasMore,
    loadingMorePayments,
    payKey,
    getFilteredPayments,
    currentCompany,
    dateFilter,
    customFromDate,
    customToDate,
    loadPayments,
    currentPayListIdsRef,
    currencySymbols,
    currencySymbolOnRight,
  } = useAppStore();

  const listRef = useRef(null);
  const filteredPayments = getFilteredPayments();

  // Re-load payments whenever company or date filter changes.
  // Using useEffect ensures the store state is fully settled before loadPayments() runs,
  // avoiding the stale-closure problem of calling setState + loadPayments() in sequence.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    loadPayments();
  }, [currentCompany, dateFilter, customFromDate, customToDate]); // eslint-disable-line

  // Keep currentPayListIds in sync
  useEffect(() => {
    currentPayListIdsRef.current = filteredPayments.map((p) => payKey(p));
  }, [filteredPayments, payKey, currentPayListIdsRef]);

  // Infinite scroll
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    function onScroll() {
      if (loadingPayments || loadingMorePayments || !paymentsHasMore) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
        loadMorePayments();
      }
    }
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [loadingPayments, loadingMorePayments, paymentsHasMore, loadMorePayments]);

  // KPI values
  const kpiUnmatched = typeof totalPaymentsCount === 'number'
    ? String(totalPaymentsCount)
    : String(payments.length);

  const kpiOpen = dashboardStats?.open_invoices != null
    ? String(dashboardStats.open_invoices)
    : '—';

  const kpiOverdue = dashboardStats?.overdue_invoices != null
    ? String(dashboardStats.overdue_invoices)
    : '—';

  let kpiValue = '—';
  if (dashboardStats?.unmatched_value != null) {
    const uv = dashboardStats.unmatched_value;
    const cur = dashboardStats.company_currency || 'USD';
    const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur + ' ';
    if (uv >= 1000000) kpiValue = sym + (uv / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    else if (uv >= 1000) kpiValue = sym + (uv / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    else kpiValue = sym + uv.toFixed(0);
  }

  return (
    <div className="left">
      <div className="summary-strip">
        <div className="sum-cards">
          <div className="sum-card highlight">
            <div className="sum-card-val">{kpiUnmatched}</div>
            <div className="sum-card-label">unmatched payments</div>
          </div>
          <div className="sum-card">
            <div className="sum-card-val">{kpiOpen}</div>
            <div className="sum-card-label">open invoices</div>
          </div>
          <div className="sum-card">
            <div className="sum-card-val" style={{ color: 'var(--amber)' }}>{kpiOverdue}</div>
            <div className="sum-card-label">overdue invoices</div>
          </div>
          <div className="sum-card">
            <div className="sum-card-val">{kpiValue}</div>
            <div className="sum-card-label">unmatched value</div>
          </div>
        </div>
      </div>

      <div className="search-wrap">
        <div className="search">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Party, amount, reference…"
            onChange={(e) => filterPayments(e.target.value)}
          />
        </div>
      </div>

      <div className="filter-row">
        {['all', 'in', 'out'].map((mode) => (
          <div
            key={mode}
            className={'fchip' + (filterMode === mode ? ' on' : '')}
            onClick={() => setFilterMode(mode)}
          >
            {mode === 'all' ? 'All' : mode === 'in' ? 'Received' : 'Paid'}
          </div>
        ))}
      </div>

      <div className="pay-list" ref={listRef}>
        {loadingPayments ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: 'var(--t3)' }}>
            Loading…
          </div>
        ) : filteredPayments.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: 'var(--t3)' }}>
            {!currentCompany
              ? 'Select a company to load payments'
              : partyFilter?.party
              ? (
                <>
                  <div>No unmatched payments for <strong style={{ color: 'var(--t2)' }}>{partyFilter.party}</strong></div>
                  <button
                    type="button"
                    onClick={clearPartyFilter}
                    style={{ marginTop: 10, fontSize: 11, color: 'var(--matcha)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                  >
                    ← Clear filter
                  </button>
                </>
              )
              : 'No payments found for this company'}
          </div>
        ) : (
          <>
            {partyFilter?.party && (
              <div className="party-filter-bar">
                <span className="party-filter-left party-filter-actions">
                  <span className="party-filter-action" onClick={selectAllPayments}>Select all</span>
                  <span className="party-filter-action" onClick={clearPaymentSelection}>Clear</span>
                </span>
                <span className="party-filter-right">
                  <span className="pfr-label">Showing:</span>
                  <span className="pfr-party">{partyFilter.party}</span>
                </span>
              </div>
            )}
            {filteredPayments.map((pay) => {
              const key = payKey(pay);
              return (
                <PaymentItem
                  key={key}
                  pay={pay}
                  isActive={key === activePayId}
                  isSelected={selectedPayIds.includes(key)}
                />
              );
            })}
            {loadingMorePayments && (
              <div style={{ padding: '8px 16px', textAlign: 'center', fontSize: 12, color: 'var(--t3)' }}>
                Loading more…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
