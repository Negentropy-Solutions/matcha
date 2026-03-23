import { useRef, useEffect } from 'react';
import { useAppStore } from '../store';
import { fmt, formatHistoryDate, appUrl } from '../lib/format';

function HistoryRow({ item }) {
  const {
    undoReconciliation,
    setHistoryViewModal,
    currencySymbols,
    currencySymbolOnRight,
  } = useAppStore();

  let allocs = [];
  try {
    if (item.allocations_json) allocs = JSON.parse(item.allocations_json);
  } catch (e) {}

  const dateStr = formatHistoryDate(item.creation);
  const currency = item.currency || '';
  const fmtAmt = (n) => fmt(n, currency, currencySymbols, currencySymbolOnRight);

  const allocSummary = allocs.length
    ? `${allocs.length} allocation${allocs.length !== 1 ? 's' : ''}: ` +
      allocs
        .slice(0, 3)
        .map((a) => `${a.invoice_number || ''} ${fmtAmt(a.allocated_amount || 0)}`)
        .join(', ') +
      (allocs.length > 3 ? '…' : '')
    : '';

  const undoDesc =
    `${item.party || ''} · ${fmtAmt(item.total_allocated || 0)} · ` +
    `${allocs.length} allocation${allocs.length !== 1 ? 's' : ''}`;

  function handleView() {
    setHistoryViewModal({
      open: true,
      party: item.party || '',
      currency: item.currency || '',
      allocs,
    });
  }

  function handleUndo() {
    undoReconciliation(String(item.name), undoDesc);
  }

  const VIEW_ICON = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
  const UNDO_ICON = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h10a5 5 0 0 1 5 5v2"/>
      <path d="M7 6l-4 4 4 4"/>
    </svg>
  );

  return (
    <div className={'history-row' + (item.status === 'Undone' ? ' undone' : '')}>
      <div className="history-row-left">
        <div className="history-row-party">{item.party || ''}</div>
        <div className="history-row-detail">
          {dateStr} · {item.owner || ''}
        </div>
        {allocSummary && (
          <div className="history-row-alloc">{allocSummary}</div>
        )}
      </div>
      <div className="history-row-right">
        <span className="history-row-amt">{fmtAmt(item.total_allocated || 0)}</span>
        {allocs.length > 0 && (
          <button
            type="button"
            className="btn history-view-btn"
            onClick={handleView}
            title="View details"
          >
            {VIEW_ICON} View
          </button>
        )}
        {item.status === 'Reconciled' ? (
          <button
            type="button"
            className="btn history-undo-btn"
            onClick={handleUndo}
            title="Undo reconciliation"
          >
            {UNDO_ICON} Undo
          </button>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--t3)' }}>Undone</span>
        )}
      </div>
    </div>
  );
}

export default function HistoryView({ visible }) {
  const {
    historyItems,
    historyTotal,
    historyCurrentPage,
    historyFromDate,
    setHistoryFromDate,
    historyToDate,
    setHistoryToDate,
    historySearch,
    setHistorySearch,
    historyHideUndone,
    setHistoryHideUndone,
    historyLimit,
    setHistoryLimit,
    historyLoading,
    historyMeta,
    loadHistory,
  } = useAppStore();

  const searchDebounceRef = useRef(null);
  // Track whether a filter-triggered reload is already pending
  const filterReloadPendingRef = useRef(false);

  function handleSearchInput(val) {
    setHistorySearch(val);
    // Search uses debounce; the useEffect below will fire after state updates
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    filterReloadPendingRef.current = true;
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      filterReloadPendingRef.current = false;
      loadHistory(1);
    }, 350);
  }

  // Reload history whenever any filter changes.
  // useEffect ensures the updated state is available before loadHistory() is called,
  // avoiding the stale-closure problem of calling setState + loadHistory() in sequence.
  // historySearch is included so that clearFilters() (which clears all at once) also triggers.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    // Skip if a search debounce timer is in flight — it will call loadHistory itself
    if (filterReloadPendingRef.current) return;
    loadHistory(1);
  }, [historyFromDate, historyToDate, historyHideUndone, historyLimit, historySearch]); // eslint-disable-line

  const totalPages =
    historyLimit > 0 ? Math.max(1, Math.ceil(historyTotal / historyLimit)) : 1;

  const hasFilter = !!(historyFromDate || historyToDate || historySearch);

  function clearFilters() {
    if (searchDebounceRef.current) { clearTimeout(searchDebounceRef.current); searchDebounceRef.current = null; }
    filterReloadPendingRef.current = false;
    setHistoryFromDate('');
    setHistoryToDate('');
    setHistorySearch('');
    // useEffect will fire after the above state updates and call loadHistory(1)
  }

  // Build pagination
  function buildPages(currentPage, total) {
    if (total <= 1) return [];
    const pages = [];
    const maxVisible = 5;
    if (total <= maxVisible + 2) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('…');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(total - 1, currentPage + 1);
      for (let j = start; j <= end; j++) {
        if (!pages.includes(j)) pages.push(j);
      }
      if (currentPage < total - 2) pages.push('…');
      if (total > 1) pages.push(total);
    }
    return pages;
  }

  const pages = buildPages(historyCurrentPage, totalPages);

  return (
    <div className="matcha-app history-view" style={visible ? {} : { display: 'none' }}>
      <div className="history-full">
        <div className="history-head">
          <h2 className="history-title">Reconciliation history</h2>
          <p className="history-desc">
            Who reconciled what and when. You can undo a reconciliation to unlink
            payments from invoices.
          </p>
        </div>

        <div className="history-filters">
          <div className="history-filter-group">
            <span className="history-filter-label">From</span>
            <input
              type="date"
              className="history-date-input"
              value={historyFromDate}
              onChange={(e) => setHistoryFromDate(e.target.value)}
            />
          </div>
          <div className="history-filter-group">
            <span className="history-filter-label">To</span>
            <input
              type="date"
              className="history-date-input"
              value={historyToDate}
              onChange={(e) => setHistoryToDate(e.target.value)}
            />
          </div>
          <div className="history-filter-group">
            <div className="search">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Search party…"
                value={historySearch}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (searchDebounceRef.current) { clearTimeout(searchDebounceRef.current); searchDebounceRef.current = null; }
                    filterReloadPendingRef.current = false;
                    loadHistory(1);
                  }
                }}
              />
            </div>
          </div>
          <label className="history-filter-group history-hide-undone-wrap" title="Hide undone reconciliations">
            <input
              type="checkbox"
              checked={historyHideUndone}
              onChange={(e) => setHistoryHideUndone(e.target.checked)}
            />
            <span className="history-filter-label">Hide undone</span>
          </label>
          {hasFilter && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={clearFilters}
              title="Clear all filters"
            >
              Clear filters
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => loadHistory(1)}
            title="Reload list"
          >
            Refresh
          </button>
        </div>

        <div className="history-list-wrap">
          <div className="history-list-scroll">
            <div className="history-list">
              {historyLoading ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>
                  Loading history…
                </div>
              ) : historyItems.length === 0 ? (
                <div
                  className="history-row"
                  style={{ justifyContent: 'center', color: 'var(--t3)', fontSize: 12 }}
                >
                  No reconciliations match your filters
                </div>
              ) : (
                historyItems.map((item) => (
                  <HistoryRow key={item.name} item={item} />
                ))
              )}
            </div>
          </div>

          <div className="history-footer">
            <span className="history-meta">{historyMeta}</span>
            <div className="history-footer-controls">
              <span className="history-per-page-wrap">
                <span className="history-filter-label">Per page</span>
                <select
                  value={historyLimit}
                  onChange={(e) => setHistoryLimit(parseInt(e.target.value, 10) || 10)}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
              </span>
              {pages.length > 0 && (
                <div className="history-pagination" style={{ display: 'inline-flex' }}>
                  <button
                    type="button"
                    className="history-page-btn"
                    disabled={historyCurrentPage <= 1}
                    onClick={() => loadHistory(historyCurrentPage - 1)}
                  >
                    Prev
                  </button>
                  {pages.map((n, i) =>
                    n === '…' ? (
                      <span key={`ellipsis-${i}`} className="history-page-ellipsis">…</span>
                    ) : (
                      <button
                        key={n}
                        type="button"
                        className={'history-page-btn' + (n === historyCurrentPage ? ' active' : '')}
                        onClick={() => loadHistory(n)}
                      >
                        {n}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    className="history-page-btn"
                    disabled={historyCurrentPage >= totalPages}
                    onClick={() => loadHistory(historyCurrentPage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
