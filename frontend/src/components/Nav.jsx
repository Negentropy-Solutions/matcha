import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { DATE_PRESETS, getDatesForFilter, getDateFilterLabel, getDateRangeLabel } from '../lib/dates';

export default function Nav({ excCount = 0 }) {
  const {
    companies,
    currentCompany,
    currentTab,
    setCurrentTab,
    dateFilter,
    customFromDate,
    customToDate,
    changeCompany,
    changeDateFilter,
    loadPayments,
    loadHistory,
    toast,
  } = useAppStore();
  // loadPayments is kept here for handleRefresh (manual reload — no stale-closure risk
  // since it doesn't follow a setState call)

  const [companyOpen, setCompanyOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [dateSearch, setDateSearch] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const companyWrapRef = useRef(null);
  const dateWrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        companyWrapRef.current &&
        !companyWrapRef.current.contains(e.target) &&
        dateWrapRef.current &&
        !dateWrapRef.current.contains(e.target)
      ) {
        setCompanyOpen(false);
        setDateOpen(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleTabClick = useCallback(
    (tab) => {
      setCurrentTab(tab);
      if (tab === 'History') loadHistory(1);
    },
    [setCurrentTab, loadHistory]
  );

  const handlePickCompany = useCallback(
    (name) => {
      changeCompany(name);
      setCompanyOpen(false);
      // loadPayments is triggered by useEffect in LeftPanel watching currentCompany
    },
    [changeCompany]
  );

  const handlePickDate = useCallback(
    (value) => {
      changeDateFilter(value);
      setDateOpen(false);
      setDateSearch('');
      // loadPayments is triggered by useEffect in LeftPanel watching dateFilter
    },
    [changeDateFilter]
  );

  const handleApplyCustomDate = useCallback(() => {
    if (!customFrom || !customTo) { toast('Please select both from and to dates'); return; }
    if (customFrom > customTo) { toast('From date must be before to date'); return; }
    changeDateFilter('custom', customFrom, customTo);
    setDateOpen(false);
    setDateSearch('');
    // loadPayments is triggered by useEffect in LeftPanel watching customFromDate/customToDate
  }, [customFrom, customTo, changeDateFilter, toast]);

  const handleRefresh = useCallback(() => {
    loadPayments();
    toast('List refreshed');
  }, [loadPayments, toast]);

  const filteredPresets = DATE_PRESETS.filter((p) => {
    if (!dateSearch) return true;
    const q = dateSearch.toLowerCase();
    return (
      p.label.toLowerCase().includes(q) ||
      getDateRangeLabel(p.value, customFromDate, customToDate).toLowerCase().includes(q)
    );
  });

  const showDatePill = currentTab === 'Reconcile';
  const showRefreshBtn = currentTab === 'Reconcile';

  return (
    <nav className="matcha-nav">
      <div className="brand">
        <img src="/assets/matcha/logo.png" alt="Matcha" className="brand-logo" />
      </div>
      <div className="nav-links">
        {['Reconcile', 'Exceptions', 'History'].map((tab) => (
          <div
            key={tab}
            className={'nav-link' + (currentTab === tab ? ' active' : '')}
            onClick={() => handleTabClick(tab)}
          >
            {tab}
            {tab === 'Exceptions' && excCount > 0 && (
              <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 2 }}>
                {excCount}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="nav-right">
        {/* Company pill */}
        <div className="nav-pill-wrap" ref={companyWrapRef}>
          <button
            type="button"
            className={'nav-pill' + (companyOpen ? ' open' : '')}
            onClick={(e) => { e.stopPropagation(); setCompanyOpen((o) => !o); setDateOpen(false); }}
            aria-haspopup="listbox"
            aria-expanded={companyOpen}
          >
            <span className="pill-text">{currentCompany || 'Select company'}</span>
            <span className="pill-chevron">▼</span>
          </button>
          <div className={'nav-dropdown' + (companyOpen ? ' open' : '')} role="listbox">
            <div className="nav-dropdown-list">
              {companies.map((c) => {
                const name = typeof c === 'string' ? c : c.name;
                return (
                  <button
                    key={name}
                    type="button"
                    className={'nav-dropdown-item' + (name === currentCompany ? ' selected' : '')}
                    onClick={() => handlePickCompany(name)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Date pill */}
        {showDatePill && (
          <div className="nav-pill-wrap" ref={dateWrapRef}>
            <button
              type="button"
              className={'nav-pill' + (dateOpen ? ' open' : '')}
              onClick={(e) => { e.stopPropagation(); setDateOpen((o) => !o); setCompanyOpen(false); }}
              aria-haspopup="listbox"
              aria-expanded={dateOpen}
            >
              <span className="pill-text">{getDateFilterLabel(dateFilter, customFromDate, customToDate)}</span>
              <span className="pill-chevron">▼</span>
            </button>
            {dateFilter !== 'all' && (
              <span className="nav-date-range">
                {getDateRangeLabel(dateFilter, customFromDate, customToDate)}
              </span>
            )}
            <div className={'nav-dropdown' + (dateOpen ? ' open' : '')} role="listbox">
              <div className="nav-dropdown-search">
                <div className="search">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="e.g. Last 3 weeks"
                    value={dateSearch}
                    onChange={(e) => setDateSearch(e.target.value)}
                    autoFocus={dateOpen}
                  />
                </div>
              </div>
              <div className="nav-dropdown-list">
                {filteredPresets.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={'nav-dropdown-item' + (p.value === dateFilter ? ' selected' : '')}
                    onClick={() => handlePickDate(p.value)}
                  >
                    <span className="item-label">{p.label}</span>
                    <span className="item-range">
                      {getDateRangeLabel(p.value, customFromDate, customToDate)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="nav-dropdown-custom">
                <div className="custom-row">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    title="From date"
                  />
                  <span style={{ color: 'var(--t3)' }}>→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    title="To date"
                  />
                </div>
                <button type="button" className="btn btn-primary" onClick={handleApplyCustomDate}>
                  Apply custom range
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Refresh button */}
        {showRefreshBtn && (
          <button type="button" className="nav-btn" onClick={handleRefresh} title="Reload payments">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
              <path d="M16 21h5v-5"/>
            </svg>
            Refresh
          </button>
        )}
      </div>
    </nav>
  );
}
