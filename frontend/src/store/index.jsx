import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiCall, parseServerMessage } from '../lib/api';
import { getDatesForFilter } from '../lib/dates';
import {
  fromCents,
  fmtDate,
  invoiceOutstanding,
  roundCurrency,
  toCents,
} from '../lib/format';

export const AppContext = createContext(null);

export function useAppStore() {
  return useContext(AppContext);
}

export function AppProvider({ children, bootData }) {
  // ── Boot / config ────────────────────────────────────────────
  const companies = bootData?.companies || [];
  const defaultCompany = bootData?.default_company || '';
  const currencySymbols = bootData?.currency_symbols || {};
  const currencySymbolOnRight = bootData?.currency_symbol_on_right || {};

  // ── Core data ────────────────────────────────────────────────
  const [payments, setPayments] = useState([]);
  const [invoices, setInvoices] = useState([]);

  // ── Selection state ──────────────────────────────────────────
  const [activePayId, setActivePayId] = useState(null);
  const [selectedPayIds, setSelectedPayIds] = useState([]);
  const [partyFilter, setPartyFilter] = useState(null);
  const [allocations, setAllocations] = useState({});
  const [trayExpanded, setTrayExpanded] = useState(false);

  // ── Filter state ─────────────────────────────────────────────
  const [filterMode, setFilterMode] = useState('all');
  const [searchQ, setSearchQ] = useState('');
  const [invoiceSearchQ, setInvoiceSearchQ] = useState('');
  const [invoiceFromDate, setInvoiceFromDate] = useState('');
  const [invoiceToDate, setInvoiceToDate] = useState('');

  // ── Company / date ───────────────────────────────────────────
  const [currentCompany, setCurrentCompany] = useState(defaultCompany);
  const [dateFilter, setDateFilterVal] = useState('this_month');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');

  // ── Loading ──────────────────────────────────────────────────
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [loadingMorePayments, setLoadingMorePayments] = useState(false);
  const [loadingMoreInvoices, setLoadingMoreInvoices] = useState(false);

  // ── Pagination / counts ──────────────────────────────────────
  const [paymentsHasMore, setPaymentsHasMore] = useState(true);
  const [invoicesHasMore, setInvoicesHasMore] = useState(true);
  const [totalPaymentsCount, setTotalPaymentsCount] = useState(null);
  const [dashboardStats, setDashboardStats] = useState(null);

  // ── Tab ──────────────────────────────────────────────────────
  const [currentTab, setCurrentTab] = useState('Reconcile');

  // ── History state ────────────────────────────────────────────
  const [historyItems, setHistoryItems] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyCurrentPage, setHistoryCurrentPage] = useState(1);
  const [historyFromDate, setHistoryFromDate] = useState('');
  const [historyToDate, setHistoryToDate] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyHideUndone, setHistoryHideUndone] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(10);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMeta, setHistoryMeta] = useState('Loading…');

  // ── Exceptions state ─────────────────────────────────────────
  const [exceptionsLoading, setExceptionsLoading] = useState(false);
  const [exceptionsPayments, setExceptionsPayments] = useState([]);
  const [exceptionsInvoices, setExceptionsInvoices] = useState([]);
  const [exceptionsTotalPayments, setExceptionsTotalPayments] = useState(0);
  const [exceptionsTotalInvoices, setExceptionsTotalInvoices] = useState(0);
  const [exceptionsTotalInSystem, setExceptionsTotalInSystem] = useState(0);
  const [exceptionsPaymentsPage, setExceptionsPaymentsPage] = useState(1);
  const [exceptionsInvoicesPage, setExceptionsInvoicesPage] = useState(1);
  const [exceptionsSearchPayments, setExceptionsSearchPayments] = useState('');
  const [exceptionsSearchInvoices, setExceptionsSearchInvoices] = useState('');
  const [exceptionsSiSummary, setExceptionsSiSummary] = useState('');
  const [exceptionsPiSummary, setExceptionsPiSummary] = useState('');
  const [exceptionsPaySummary, setExceptionsPaySummary] = useState('');
  const exceptionsLimit = 50;

  // ── Modal state ──────────────────────────────────────────────
  const [xcoModal, setXcoModal] = useState({
    open: false,
    from: '',
    dest: '',
    jvRows: [],
    reconciling: false,
  });
  const [undoModal, setUndoModal] = useState({ open: false, logName: null, description: '' });
  const [historyViewModal, setHistoryViewModal] = useState({ open: false, party: '', currency: '', allocs: [] });

  // ── Toasts ───────────────────────────────────────────────────
  const [toasts, setToasts] = useState([]);

  // ── FX maps (refs — updated without triggering re-render mid-typing) ──
  const invFxMapRef = useRef({});
  const paymentFxMapRef = useRef({});
  const invPaymentFxMapRef = useRef({});
  const invAgainstMapRef = useRef({});
  const [fxVersion, setFxVersion] = useState(0);

  // ── Mutable refs for non-render state ────────────────────────
  const paymentsOffsetRef = useRef(0);
  const invoicesOffsetRef = useRef(0);
  const basePaymentsCacheRef = useRef(null);
  const invoicesCacheRef = useRef({});
  const currentPayListIdsRef = useRef([]);
  const lastClickedPayIdRef = useRef(null);
  const activePayObjRef = useRef(null);
  const searchDebounceTimerRef = useRef(null);
  const historySearchDebounceTimerRef = useRef(null);
  const fxDebounceTimerRef = useRef(null);
  const fxRefreshingRef = useRef(false);
  const refreshFxPreviewRef = useRef(null);

  // ── Helpers ──────────────────────────────────────────────────
  const toast = useCallback((msg) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  function payKey(pay) {
    if (!pay) return '';
    if (pay.reference_type === 'Journal Entry' && pay.reference_row)
      return (pay.id || '') + '::' + (pay.reference_row || '');
    return pay.id || '';
  }

  function getPayByKey(key, paymentsArr) {
    const list = paymentsArr || payments;
    if (!key) return null;
    const parts = String(key).split('::');
    if (parts.length === 2) {
      const [id, row] = parts;
      return (
        list.find(
          (x) =>
            x.id === id && String(x.reference_row || '') === String(row || '')
        ) || null
      );
    }
    return list.find((x) => x.id === key) || null;
  }

  function getInvoicesKey(p) {
    if (!p) return '';
    return [
      p.company || '',
      p.party_type || '',
      p.party || '',
      p.receivable_payable_account || '',
    ].join('||');
  }

  function allocTotal(allocs) {
    const a = allocs || allocations;
    const cents = Object.keys(a).reduce(
      (s, k) => s + toCents(a[k]),
      0
    );
    return fromCents(cents);
  }

  function selectedPaymentsTotal(pays, selIds, actId) {
    const ids = (selIds || selectedPayIds).length
      ? selIds || selectedPayIds
      : actId || activePayId
      ? [actId || activePayId]
      : [];
    return ids.reduce((s, id) => {
      const pay = getPayByKey(id, pays || payments);
      return s + (pay ? roundCurrency(pay.amount || 0) : 0);
    }, 0);
  }

  function remaining(pay, allocs) {
    const a = allocs || allocations;
    const totalC = toCents(
      (selectedPayIds.length > 0
        ? selectedPaymentsTotal()
        : pay
        ? pay.amount || 0
        : 0)
    );
    const allocC = toCents(allocTotal(a));
    return fromCents(Math.max(0, totalC - allocC));
  }

  // ── Payment caching ──────────────────────────────────────────
  function cacheBasePayments(pays, offset, hasMore, count) {
    if (partyFilter) return;
    basePaymentsCacheRef.current = {
      payments: (pays || payments).slice(),
      offset: offset ?? paymentsOffsetRef.current,
      hasMore: hasMore ?? paymentsHasMore,
      totalCount: count ?? totalPaymentsCount,
    };
  }

  function restoreBasePayments(cb) {
    const cache = basePaymentsCacheRef.current;
    if (!cache) return false;
    paymentsOffsetRef.current = cache.offset || 0;
    setPaymentsHasMore(!!cache.hasMore);
    setTotalPaymentsCount(cache.totalCount);
    setPayments(cache.payments.slice());
    if (cb) cb();
    return true;
  }

  function cacheInvoicesFor(p, invs, offset, hasMore) {
    const key = getInvoicesKey(p);
    if (!key) return;
    invoicesCacheRef.current[key] = {
      invoices: (invs || invoices).slice(),
      offset: offset ?? invoicesOffsetRef.current,
      hasMore: hasMore ?? invoicesHasMore,
    };
  }

  function restoreInvoicesFor(p, cb) {
    const key = getInvoicesKey(p);
    if (!key) return false;
    const c = invoicesCacheRef.current[key];
    if (!c) return false;
    invoicesOffsetRef.current = c.offset || 0;
    setInvoicesHasMore(!!c.hasMore);
    setInvoices((c.invoices || []).slice());
    if (cb) cb();
    return true;
  }

  // ── Build allocation list for reconcile ──────────────────────
  function buildAllocationList(allocs, selIds, actId, pays, invs) {
    const a = allocs || allocations;
    const p = getPayByKey(actId || activePayId, pays || payments);
    if (!p) return null;
    const invIds = Object.keys(a);
    if (!invIds.length) return null;
    const payIds = (selIds || selectedPayIds).length
      ? (selIds || selectedPayIds).slice()
      : [actId || activePayId];
    const payList = payIds
      .map((id) => getPayByKey(id, pays || payments))
      .filter(Boolean);
    if (!payList.length) return null;
    const remaining = {};
    payList.forEach((pay) => {
      const k = pay.reference_row
        ? pay.id + '|' + pay.reference_row
        : pay.id;
      remaining[k] = roundCurrency(pay.amount || 0);
    });
    const allocList = [];
    const invList = invs || invoices;
    invIds.forEach((invId) => {
      const inv = invList.find((i) => i.id === invId);
      const invoiceType = inv?.invoice_type || 'Sales Invoice';
      let amtLeft = roundCurrency(a[invId] || 0);
      if (amtLeft <= 0) return;
      for (let i = 0; i < payList.length && amtLeft > 0.001; i++) {
        const pay = payList[i];
        const k = pay.reference_row
          ? pay.id + '|' + pay.reference_row
          : pay.id;
        const payRem = remaining[k] || 0;
        if (payRem <= 0) continue;
        const allocAmt = roundCurrency(Math.min(amtLeft, payRem));
        if (allocAmt <= 0) continue;
        remaining[k] = roundCurrency(payRem - allocAmt);
        amtLeft = roundCurrency(amtLeft - allocAmt);
        const row = {
          payment_name: pay.id,
          payment_key: payKey(pay),
          invoice_type: invoiceType,
          invoice_number: invId,
          allocated_amount: allocAmt,
          // xco metadata — needed so reconcile can route to reconcile_xco
          xco: inv?.xco || false,
          invoice_company: inv?.company || '',
          xco_receivable_payable_account: inv?.xco_receivable_payable_account || '',
        };
        if (pay.reference_type === 'Journal Entry' && pay.reference_row)
          row.reference_row = pay.reference_row;
        allocList.push(row);
      }
    });
    return allocList;
  }

  // ── Build invAgainstMap ───────────────────────────────────────
  function buildInvAgainstMap() {
    invAgainstMapRef.current = {};
    if (!selectedPayIds || selectedPayIds.length <= 1) return;
    const al = buildAllocationList();
    if (!al || !al.length) return;
    al.forEach((row) => {
      const id = row.invoice_number;
      invAgainstMapRef.current[id] = invAgainstMapRef.current[id] || [];
      if (!invAgainstMapRef.current[id].includes(row.payment_name))
        invAgainstMapRef.current[id].push(row.payment_name);
    });
  }

  // ── FX preview ───────────────────────────────────────────────
  const refreshFxPreview = useCallback(() => {
    const p = getPayByKey(activePayId);
    if (!p || !Object.keys(allocations).length) {
      invFxMapRef.current = {};
      paymentFxMapRef.current = {};
      invPaymentFxMapRef.current = {};
      setFxVersion((v) => v + 1);
      return;
    }
    const allocList = buildAllocationList();
    if (!allocList || !allocList.length) {
      invFxMapRef.current = {};
      paymentFxMapRef.current = {};
      invPaymentFxMapRef.current = {};
      setFxVersion((v) => v + 1);
      return;
    }
    apiCall(
      'matcha.api.payment_reconciliation.reconcile',
      null,
      {
        company: p.company,
        party_type: p.party_type,
        party: p.party,
        receivable_payable_account: p.receivable_payable_account,
        allocations: JSON.stringify(allocList),
        preview_only: 1,
      }
    ).then((res) => {
      if (res.exc) return;
      const details = res.message?.allocation_details;
      buildFxMapsFromDetails(allocList, details || [], p.currency);
      setFxVersion((v) => v + 1);
    }).catch(() => {});
  }, [activePayId, allocations, selectedPayIds, invoices, payments]); // eslint-disable-line

  // Keep ref always pointing at the latest version so debounced timeouts never use a stale closure.
  useEffect(() => { refreshFxPreviewRef.current = refreshFxPreview; }, [refreshFxPreview]);

  // Rebuild invAgainstMap and trigger FX preview whenever allocations change.
  useEffect(() => {
    // invAgainstMap: rebuild immediately so "adjusted against" badges on invoice rows are current.
    buildInvAgainstMap();
    setFxVersion((v) => v + 1); // force re-render so badges appear without waiting for FX call

    // FX preview: debounce the API call to avoid hammering the backend on every keystroke.
    if (fxDebounceTimerRef.current) clearTimeout(fxDebounceTimerRef.current);
    fxDebounceTimerRef.current = setTimeout(() => {
      fxDebounceTimerRef.current = null;
      if (refreshFxPreviewRef.current) refreshFxPreviewRef.current();
    }, 400);
    return () => {
      if (fxDebounceTimerRef.current) clearTimeout(fxDebounceTimerRef.current);
    };
  }, [allocations]); // eslint-disable-line

  function buildFxMapsFromDetails(allocList, details) {
    invFxMapRef.current = {};
    paymentFxMapRef.current = {};
    invPaymentFxMapRef.current = {};
    if (!details) return;
    // Map directly by invoice_number from the backend response so FX
    // values always align with the correct invoice, regardless of array order.
    details.forEach((d) => {
      const invId = d.invoice_number;
      const pKey = d.payment_name;
      const fx =
        d.difference_amount != null ? parseFloat(d.difference_amount) : 0;
      if (!invId || !pKey || Math.abs(fx) < 1e-6) return;
      paymentFxMapRef.current[pKey] =
        (paymentFxMapRef.current[pKey] || 0) + fx;
      invFxMapRef.current[invId] =
        (invFxMapRef.current[invId] || 0) + fx;
      invPaymentFxMapRef.current[invId] =
        invPaymentFxMapRef.current[invId] || [];
      invPaymentFxMapRef.current[invId].push({
        payKey: pKey,
        payLabel: pKey,
        fx,
      });
    });
  }

  // ── KPI update helper ─────────────────────────────────────────
  function updateKpi(count, stats) {
    if (count != null) setTotalPaymentsCount(count);
    if (stats != null) setDashboardStats(stats);
  }

  // ── Load payments ─────────────────────────────────────────────
  const loadPayments = useCallback(
    (opts) => {
      const keepPartyFilter = opts?.keepPartyFilter;
      const callback = opts?.callback;
      const ignoreDateFilter = opts?.ignoreDateFilter;
      // explicitPartyFilter lets callers bypass the stale-closure problem: pass the
      // freshly-created filter object directly instead of relying on state being settled.
      const explicitPartyFilter = opts?.explicitPartyFilter ?? undefined;
      const company = currentCompany || defaultCompany;
      if (!company) {
        setPayments([]);
        setTotalPaymentsCount(null);
        setDashboardStats(null);
        if (callback) callback([]);
        return;
      }
      if (!keepPartyFilter) setPartyFilter(null);
      const dates = getDatesForFilter(dateFilter, customFromDate, customToDate);
      setLoadingPayments(true);
      paymentsOffsetRef.current = 0;
      setPaymentsHasMore(true);
      const includeCount = !searchQ;
      const args = {
        company,
        limit: 50,
        offset: 0,
        include_count: includeCount ? 1 : 0,
      };
      if (!ignoreDateFilter) {
        if (dates.from_date) args.from_date = dates.from_date;
        if (dates.to_date) args.to_date = dates.to_date;
      }
      // Use explicitly-passed filter first (avoids stale closure), then fall back to state.
      const pf = explicitPartyFilter !== undefined ? explicitPartyFilter : (keepPartyFilter ? partyFilter : null);
      if (pf?.party_type) args.party_type = pf.party_type;
      if (pf?.party) args.party = pf.party;
      if (searchQ && !(pf?.party)) args.search = searchQ;

      apiCall('matcha.api.payment_reconciliation.get_payments', args)
        .then((res) => {
          setLoadingPayments(false);
          if (res.exc) {
            toast(parseServerMessage(res, 'Failed to load payments'));
            if (callback) callback([]);
            return;
          }
          let newPays, count, hasMore;
          if (res.message?.items) {
            newPays = res.message.items || [];
            count = res.message.count ?? null;
            hasMore = !!res.message.has_more;
          } else {
            newPays = res.message || [];
            count = null;
            hasMore = newPays.length >= 50;
          }
          // Safety net for party-filter mode
          const activePay = activePayObjRef.current;
          const actId = activePayId;
          if (pf?.party && activePay && actId && !newPays.find((p) => payKey(p) === actId)) {
            newPays.unshift(activePay);
          }
          if (!pf) {
            cacheBasePayments(newPays, 0, hasMore, count);
          }
          setPayments(newPays);
          setPaymentsHasMore(hasMore);
          setTotalPaymentsCount(count);
          if (callback) callback(newPays);
        })
        .catch(() => {
          setLoadingPayments(false);
          toast('Failed to load payments');
          if (callback) callback([]);
        });

      // Dashboard stats
      apiCall('matcha.api.payment_reconciliation.get_dashboard_stats', {
        company,
        from_date: ignoreDateFilter ? '' : dates.from_date || '',
        to_date: ignoreDateFilter ? '' : dates.to_date || '',
      })
        .then((res) => {
          if (!res || res.exc) return;
          setDashboardStats(res.message || null);
        })
        .catch(() => {});
    },
    [currentCompany, defaultCompany, dateFilter, customFromDate, customToDate, searchQ, partyFilter, activePayId] // eslint-disable-line
  );

  const loadMorePayments = useCallback(() => {
    if (loadingPayments || loadingMorePayments || !paymentsHasMore) return;
    const company = currentCompany || defaultCompany;
    if (!company) return;
    const dates = getDatesForFilter(dateFilter, customFromDate, customToDate);
    setLoadingMorePayments(true);
    paymentsOffsetRef.current += 50;
    const args = {
      company,
      limit: 50,
      offset: paymentsOffsetRef.current,
      include_count: 0,
    };
    if (dates.from_date) args.from_date = dates.from_date;
    if (dates.to_date) args.to_date = dates.to_date;
    if (partyFilter?.party_type) args.party_type = partyFilter.party_type;
    if (partyFilter?.party) args.party = partyFilter.party;
    if (searchQ && !partyFilter?.party) args.search = searchQ;
    apiCall('matcha.api.payment_reconciliation.get_payments', args)
      .then((res) => {
        setLoadingMorePayments(false);
        if (!res || res.exc) { paymentsOffsetRef.current -= 50; return; }
        const items = res.message?.items
          ? res.message.items
          : res.message || [];
        const existing = new Set(payments.map((p) => payKey(p)));
        const newItems = items.filter((p) => {
          const k = payKey(p);
          if (existing.has(k)) return false;
          existing.add(k);
          return true;
        });
        const hasMore =
          res.message?.has_more != null
            ? !!res.message.has_more
            : items.length >= 50;
        setPayments((prev) => [...prev, ...newItems]);
        setPaymentsHasMore(hasMore);
      })
      .catch(() => {
        setLoadingMorePayments(false);
        paymentsOffsetRef.current -= 50;
      });
  }, [loadingPayments, loadingMorePayments, paymentsHasMore, currentCompany, defaultCompany, dateFilter, customFromDate, customToDate, partyFilter, searchQ, payments]); // eslint-disable-line

  // ── Load invoices ─────────────────────────────────────────────
  const loadInvoicesForPayment = useCallback(
    (p, cb) => {
      if (!p || !p.receivable_payable_account) {
        setInvoices([]);
        if (cb) cb([]);
        return;
      }
      if (restoreInvoicesFor(p, () => { if (cb) cb(invoices); })) return;
      setLoadingInvoices(true);
      invoicesOffsetRef.current = 0;
      setInvoicesHasMore(true);
      apiCall('matcha.api.payment_reconciliation.get_invoices', {
        company: p.company,
        party_type: p.party_type,
        party: p.party,
        receivable_payable_account: p.receivable_payable_account,
        limit: 50,
        offset: 0,
        exclude_payment_name: p.id || '',
        include_xco: 1,
      })
        .then((res) => {
          setLoadingInvoices(false);
          if (res.exc) { setInvoices([]); if (cb) cb([]); return; }
          const list = (res.message || []).map((i) => ({
            ...i,
            due: i.due ? fmtDate(i.due) : '',
            xco: !!i.xco,
          }));
          setInvoices(list);
          const hasMore = list.length >= 50;
          setInvoicesHasMore(hasMore);
          cacheInvoicesFor(p, list, 0, hasMore);
          if (cb) cb(list);
        })
        .catch(() => {
          setLoadingInvoices(false);
          setInvoices([]);
          if (cb) cb([]);
        });
    },
    [] // eslint-disable-line
  );

  const loadMoreInvoices = useCallback(() => {
    if (loadingInvoices || loadingMoreInvoices || !invoicesHasMore) return;
    const p = getPayByKey(activePayId) || activePayObjRef.current;
    if (!p) return;
    setLoadingMoreInvoices(true);
    invoicesOffsetRef.current += 50;
    apiCall('matcha.api.payment_reconciliation.get_invoices', {
      company: p.company,
      party_type: p.party_type,
      party: p.party,
      receivable_payable_account: p.receivable_payable_account,
      limit: 50,
      offset: invoicesOffsetRef.current,
      exclude_payment_name: p.id || '',
      include_xco: 0,
    })
      .then((res) => {
        setLoadingMoreInvoices(false);
        if (!res || res.exc) { invoicesOffsetRef.current -= 50; return; }
        const list = (res.message || []).map((i) => ({
          ...i,
          due: i.due ? fmtDate(i.due) : '',
        }));
        const existing = new Set(invoices.map((i) => i.id));
        const newItems = list.filter((i) => {
          if (existing.has(i.id)) return false;
          existing.add(i.id);
          return true;
        });
        const hasMore = list.length >= 50;
        setInvoices((prev) => [...prev, ...newItems]);
        setInvoicesHasMore(hasMore);
        cacheInvoicesFor(p);
      })
      .catch(() => {
        setLoadingMoreInvoices(false);
        invoicesOffsetRef.current -= 50;
      });
  }, [loadingInvoices, loadingMoreInvoices, invoicesHasMore, activePayId, invoices]); // eslint-disable-line

  // ── Invoice filter helper ─────────────────────────────────────
  function applyInvoiceFilters(list) {
    const q = (invoiceSearchQ || '').trim().toLowerCase();
    const from = (invoiceFromDate || '').trim();
    const to = (invoiceToDate || '').trim();
    if (!q && !from && !to) return list;
    return list.filter((inv) => {
      if (q) {
        const id = (inv.id || '').toLowerCase();
        const party = (inv.party || '').toLowerCase();
        const company = (inv.company || '').toLowerCase();
        if (!id.includes(q) && !party.includes(q) && !company.includes(q)) return false;
      }
      const post = (inv.posting_date || '').toString();
      if (from && post < from) return false;
      if (to && post > to) return false;
      return true;
    });
  }

  function getPaymentInvoices() {
    const p = getPayByKey(activePayId);
    if (!p) return [];
    return invoices.filter((i) => i.party === p.party);
  }

  // ── Select payment ───────────────────────────────────────────
  const selectPayment = useCallback(
    (id, e) => {
      setInvoiceSearchQ('');
      setInvoiceFromDate('');
      setInvoiceToDate('');

      if (e?.shiftKey) {
        const fromIdx = currentPayListIdsRef.current.indexOf(lastClickedPayIdRef.current);
        const toIdx = currentPayListIdsRef.current.indexOf(id);
        if (fromIdx !== -1 && toIdx !== -1) {
          const lo = Math.min(fromIdx, toIdx);
          const hi = Math.max(fromIdx, toIdx);
          const range = currentPayListIdsRef.current.slice(lo, hi + 1);
          setSelectedPayIds((prev) => {
            const set = new Set(prev);
            range.forEach((pid) => set.add(pid));
            return [...set];
          });
          setActivePayId(id);
          lastClickedPayIdRef.current = id;
          const p = getPayByKey(id);
          if (p) loadInvoicesForPayment(p);
        }
        return;
      }

      lastClickedPayIdRef.current = id;
      const p = getPayByKey(id);
      if (!p) {
        setActivePayId(null);
        setSelectedPayIds([]);
        setPartyFilter(null);
        setAllocations({});
        loadPayments({ keepPartyFilter: true });
        return;
      }
      activePayObjRef.current = p;

      if (partyFilter?.party) {
        setSelectedPayIds((prev) => {
          const idx = prev.indexOf(id);
          if (idx === -1) {
            const next = [...prev, id];
            setActivePayId(id);
            return next;
          } else {
            const next = prev.filter((x) => x !== id);
            if (next.length === 0) {
              // Deselected all - clear party filter
              setPartyFilter(null);
              setActivePayId(null);
              lastClickedPayIdRef.current = null;
              setAllocations({});
              setInvoices([]);
              if (!restoreBasePayments()) loadPayments();
              return [];
            }
            if (activePayId === id) {
              setActivePayId(next[next.length - 1]);
            }
            setAllocations({});
            setTrayExpanded(false);
            return next;
          }
        });
        const pFocus = getPayByKey(activePayId);
        if (pFocus) loadInvoicesForPayment(pFocus);
        return;
      }

      setActivePayId(id);
      setAllocations({});
      setTrayExpanded(false);
      cacheBasePayments();
      const newPartyFilter = { party_type: p.party_type, party: p.party };
      setPartyFilter(newPartyFilter);
      setSelectedPayIds([id]);
      loadPayments({
        keepPartyFilter: true,
        callback: (newPays) => {
          const pNow = newPays.find((x) => payKey(x) === id) || p;
          loadInvoicesForPayment(pNow);
        },
      });
    },
    [activePayId, partyFilter, loadPayments, loadInvoicesForPayment, payments, invoices] // eslint-disable-line
  );

  const selectAllPayments = useCallback(() => {
    if (!partyFilter) return;
    setSelectedPayIds(currentPayListIdsRef.current.slice());
    const p = getPayByKey(activePayId);
    if (p) loadInvoicesForPayment(p);
  }, [partyFilter, activePayId, loadInvoicesForPayment]); // eslint-disable-line

  const clearPaymentSelection = useCallback(() => {
    if (!partyFilter) return;
    setInvoiceSearchQ('');
    setInvoiceFromDate('');
    setInvoiceToDate('');
    setSelectedPayIds([]);
    setPartyFilter(null);
    setActivePayId(null);
    lastClickedPayIdRef.current = null;
    setAllocations({});
    setInvoices([]);
    if (searchQ) {
      basePaymentsCacheRef.current = null;
      loadPayments();
    } else {
      if (!restoreBasePayments()) loadPayments();
    }
  }, [partyFilter, searchQ, loadPayments]); // eslint-disable-line

  const clearPartyFilter = useCallback(() => {
    setInvoiceSearchQ('');
    setInvoiceFromDate('');
    setInvoiceToDate('');
    setPartyFilter(null);
    setSelectedPayIds([]);
    setActivePayId(null);
    setAllocations({});
    setInvoices([]);
    if (searchQ) {
      basePaymentsCacheRef.current = null;
      loadPayments();
    } else {
      if (!restoreBasePayments()) loadPayments();
    }
  }, [searchQ, loadPayments]); // eslint-disable-line

  // ── Toggle invoice allocation ─────────────────────────────────
  const toggleInvoice = useCallback(
    (invId) => {
      const p = getPayByKey(activePayId);
      setAllocations((prev) => {
        if (prev[invId] !== undefined) {
          const next = { ...prev };
          delete next[invId];
          return next;
        }
        const inv = invoices.find((i) => i.id === invId);
        const remC = toCents(remaining(p, prev));
        if (remC <= 0) { toast('No remaining amount'); return prev; }
        const outC = toCents(invoiceOutstanding(inv));
        const allocC = Math.min(outC, remC);
        if (allocC <= 0) { toast('No remaining amount'); return prev; }
        const next = { ...prev, [invId]: fromCents(allocC) };
        return next;
      });
    },
    [activePayId, invoices, selectedPayIds, payments] // eslint-disable-line
  );

  const updateAlloc = useCallback(
    (invId, val) => {
      const inv = invoices.find((i) => i.id === invId);
      const p = getPayByKey(activePayId);
      if (!inv || !p) return;
      const desiredC = toCents(val);
      const outC = toCents(invoiceOutstanding(inv));
      setAllocations((prev) => {
        const currentC = toCents(prev[invId] || 0);
        const otherAllocC = toCents(allocTotal(prev)) - currentC;
        const totalC = toCents(
          selectedPayIds.length > 0 ? selectedPaymentsTotal() : p.amount || 0
        );
        const maxForThisC = Math.max(0, Math.min(outC, totalC - otherAllocC));
        const finalC = Math.max(0, Math.min(desiredC, maxForThisC));
        const next = { ...prev, [invId]: fromCents(finalC) };
        return next;
      });
    },
    [activePayId, invoices, selectedPayIds, payments] // eslint-disable-line
  );

  const selectAllInvoices = useCallback(() => {
    const p = getPayByKey(activePayId);
    if (!p) return;
    const invs = getPaymentInvoices();
    const newAllocs = {};
    let remC = toCents(selectedPayIds.length > 0 ? selectedPaymentsTotal() : p.amount || 0);
    invs.forEach((inv) => {
      if (remC <= 0) return;
      const outC = toCents(invoiceOutstanding(inv));
      const allocC = Math.min(outC, remC);
      if (allocC > 0) {
        newAllocs[inv.id] = fromCents(allocC);
        remC -= allocC;
      }
    });
    setAllocations(newAllocs);
  }, [activePayId, invoices, selectedPayIds, payments]); // eslint-disable-line

  const clearTray = useCallback(() => {
    setAllocations({});
    setTrayExpanded(false);
    invFxMapRef.current = {};
    paymentFxMapRef.current = {};
    invPaymentFxMapRef.current = {};
    setFxVersion((v) => v + 1);
  }, []);

  // ── Reconcile ─────────────────────────────────────────────────
  const doReconcile = useCallback(
    (onReconciling, onDone) => {
      const p = getPayByKey(activePayId);
      if (!p) return;
      const allocList = buildAllocationList();
      if (!allocList?.length) return;

      // Split into same-company and cross-company (xco) allocations
      const sameCoAllocs = allocList.filter((a) => !a.xco);
      const xcoAllocs = allocList.filter((a) => a.xco);
      const totalCount = allocList.length;

      if (onReconciling) onReconciling();

      const onSuccess = (fxTotal) => {
        setAllocations({});
        setActivePayId(null);
        activePayObjRef.current = null;
        setInvoices([]);
        const invKey = getInvoicesKey(p);
        if (invKey) delete invoicesCacheRef.current[invKey];
        invFxMapRef.current = {};
        paymentFxMapRef.current = {};
        invPaymentFxMapRef.current = {};
        let msg = totalCount > 1
          ? `${p.party} — reconciled ${totalCount} invoices`
          : `${p.party} — reconciled`;
        if (fxTotal != null && Math.abs(fxTotal) > 1e-6)
          msg += ` · FX ${fxTotal > 0 ? 'gain' : 'loss'}`;
        toast(msg);
        loadPayments();
        if (onDone) onDone(true);
      };

      const onFail = (res) => {
        toast(parseServerMessage(res, 'Reconciliation failed'));
        if (onDone) onDone(false);
      };

      // Helper: run same-company reconcile then optionally xco, return combined promise
      const runSameCo = () => {
        if (!sameCoAllocs.length) return Promise.resolve(null);
        return apiCall('matcha.api.payment_reconciliation.reconcile', null, {
          company: p.company,
          party_type: p.party_type,
          party: p.party,
          receivable_payable_account: p.receivable_payable_account,
          allocations: JSON.stringify(sameCoAllocs),
        }).then((res) => {
          if (res.exc) throw res;
          return res.message?.total_fx_gain_loss ?? null;
        });
      };

      const runXco = () => {
        if (!xcoAllocs.length) return Promise.resolve(null);
        return apiCall('matcha.api.payment_reconciliation.reconcile_xco', null, {
          payment_company: p.company,
          party_type: p.party_type,
          party: p.party,
          payment_name: p.id,
          receivable_payable_account: p.receivable_payable_account,
          allocations: JSON.stringify(xcoAllocs),
        }).then((res) => {
          if (res.exc) throw res;
          return null;
        });
      };

      runSameCo()
        .then((fx) => runXco().then(() => fx))
        .then((fx) => onSuccess(fx))
        .catch((res) => onFail(res));
    },
    [activePayId, allocations, selectedPayIds, invoices, payments, loadPayments] // eslint-disable-line
  );

  // ── Company / date change ─────────────────────────────────────
  const changeCompany = useCallback(
    (company) => {
      setCurrentCompany(company || '');
      setActivePayId(null);
      activePayObjRef.current = null;
      setSelectedPayIds([]);
      setPartyFilter(null);
      setAllocations({});
      setInvoices([]);
      basePaymentsCacheRef.current = null;
      invoicesCacheRef.current = {};
    },
    []
  );

  const changeDateFilter = useCallback(
    (value, fromDate, toDate) => {
      setDateFilterVal(value || 'this_month');
      if (value === 'custom') {
        setCustomFromDate(fromDate || '');
        setCustomToDate(toDate || '');
      }
      setActivePayId(null);
      activePayObjRef.current = null;
      setSelectedPayIds([]);
      setPartyFilter(null);
      setAllocations({});
      setInvoices([]);
      basePaymentsCacheRef.current = null;
      invoicesCacheRef.current = {};
    },
    []
  );

  // ── Search ────────────────────────────────────────────────────
  const filterPayments = useCallback(
    (q) => {
      const qLow = (q || '').toLowerCase();
      setSearchQ(qLow);
      if (!partyFilter) {
        if (searchDebounceTimerRef.current) clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = setTimeout(() => {
          basePaymentsCacheRef.current = null;
          loadPayments();
        }, 180);
      }
    },
    [partyFilter, loadPayments]
  );

  // ── History ───────────────────────────────────────────────────
  const loadHistory = useCallback(
    (page) => {
      const p = page != null && page >= 1 ? page : 1;
      setHistoryCurrentPage(p);
      const company = currentCompany || companies[0]?.name || '';
      if (!company) {
        setHistoryItems([]);
        setHistoryMeta('Select a company');
        return;
      }
      setHistoryLoading(true);
      const limit = historyLimit;
      const offset = (p - 1) * limit;
      const args = { company, limit, offset };
      if (historyFromDate) args.from_date = historyFromDate;
      if (historyToDate) args.to_date = historyToDate;
      if (historySearch) args.search = historySearch;
      if (historyHideUndone) args.hide_undone = '1';
      apiCall(
        'matcha.api.payment_reconciliation.get_payment_reconciliation_history',
        args
      )
        .then((res) => {
          setHistoryLoading(false);
          if (res.exc) {
            setHistoryItems([]);
            setHistoryMeta('Failed to load');
            return;
          }
          const data = res?.message ?? {};
          const items = Array.isArray(data.items) ? data.items : [];
          const total = typeof data.total === 'number' ? data.total : 0;
          setHistoryItems(items);
          setHistoryTotal(total);
          const from = total === 0 ? 0 : offset + 1;
          const to = offset + items.length;
          if (total === 0) setHistoryMeta('No reconciliations');
          else if (total <= limit && p === 1)
            setHistoryMeta(`${total} reconciliation${total !== 1 ? 's' : ''}`);
          else setHistoryMeta(`Showing ${from}–${to} of ${total}`);
        })
        .catch(() => {
          setHistoryLoading(false);
          setHistoryMeta('Failed to load history');
        });
    },
    [currentCompany, companies, historyLimit, historyFromDate, historyToDate, historySearch, historyHideUndone] // eslint-disable-line
  );

  const undoReconciliation = useCallback((logName, description) => {
    setUndoModal({ open: true, logName, description: description || 'This reconciliation will be undone.' });
  }, []);

  const confirmUndo = useCallback(() => {
    const logName = undoModal.logName;
    if (!logName) { setUndoModal((m) => ({ ...m, open: false })); return; }
    setUndoModal((m) => ({ ...m, confirming: true }));
    apiCall('matcha.api.payment_reconciliation.undo_payment_reconciliation', null, {
      log_name: logName,
    })
      .then((res) => {
        setUndoModal({ open: false, logName: null, description: '' });
        if (res.exc) { toast('Failed to undo'); return; }
        toast('Reconciliation undone');
        invoicesCacheRef.current = {};
        basePaymentsCacheRef.current = null;
        setActivePayId(null);
        activePayObjRef.current = null;
        setSelectedPayIds([]);
        setInvoices([]);
        loadPayments();
        if (currentTab === 'History') loadHistory(1);
      })
      .catch(() => {
        setUndoModal({ open: false, logName: null, description: '' });
        toast('Failed to undo');
      });
  }, [undoModal, loadPayments, loadHistory, currentTab]); // eslint-disable-line

  // ── Exceptions ────────────────────────────────────────────────
  const loadExceptions = useCallback(
    (payPage, invPage, updateOnly) => {
      const pPage = payPage != null && payPage >= 1 ? payPage : exceptionsPaymentsPage;
      const iPage = invPage != null && invPage >= 1 ? invPage : exceptionsInvoicesPage;
      if (payPage != null) setExceptionsPaymentsPage(pPage);
      if (invPage != null) setExceptionsInvoicesPage(iPage);
      const company = currentCompany || companies[0]?.name || '';
      if (!company) {
        setExceptionsTotalInSystem(0);
        setExceptionsPayments([]);
        setExceptionsInvoices([]);
        return;
      }
      if (!updateOnly) setExceptionsLoading(true);
      const offsetPay = (pPage - 1) * exceptionsLimit;
      const offsetInv = (iPage - 1) * exceptionsLimit;
      const args = {
        company,
        limit_per_type: exceptionsLimit,
        offset_payments: offsetPay,
        offset_invoices: offsetInv,
      };
      if (exceptionsSearchPayments) args.search_payments = exceptionsSearchPayments;
      if (exceptionsSearchInvoices) args.search_invoices = exceptionsSearchInvoices;
      apiCall('matcha.api.payment_reconciliation.get_exceptions', args)
        .then((res) => {
          setExceptionsLoading(false);
          if (res.exc) return;
          const data = res?.message || {};
          const unmatched = Array.isArray(data.unmatched_payments) ? data.unmatched_payments : [];
          const ageing = Array.isArray(data.ageing_invoices) ? data.ageing_invoices : [];
          const totalInSystem = typeof data.total_in_system === 'number' ? data.total_in_system : 0;
          const totalPay = typeof data.total_unmatched_payments === 'number' ? data.total_unmatched_payments : unmatched.length;
          const totalInv = typeof data.total_ageing_invoices === 'number' ? data.total_ageing_invoices : ageing.length;
          setExceptionsTotalInSystem(totalInSystem);
          setExceptionsTotalPayments(totalPay);
          setExceptionsTotalInvoices(totalInv);
          if (!updateOnly || updateOnly === 'payments') setExceptionsPayments(unmatched);
          if (!updateOnly || updateOnly === 'invoices') setExceptionsInvoices(ageing);

          const payTotal = unmatched.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
          const payCur = unmatched[0]?.currency || '';
          setExceptionsPaySummary(`${totalPay} total`);
          const totalAgeingSi = typeof data.total_ageing_si === 'number' ? data.total_ageing_si : 0;
          const totalAgeingPi = typeof data.total_ageing_pi === 'number' ? data.total_ageing_pi : 0;
          const totalSiAmt = typeof data.total_si_amount === 'number' ? data.total_si_amount : 0;
          const totalPiAmt = typeof data.total_pi_amount === 'number' ? data.total_pi_amount : 0;
          setExceptionsSiSummary(`${totalAgeingSi}`);
          setExceptionsPiSummary(`${totalAgeingPi}`);

          setDashboardStats((prev) =>
            prev ? { ...prev, exceptions_count: totalInSystem } : { exceptions_count: totalInSystem }
          );
        })
        .catch(() => {
          setExceptionsLoading(false);
        });
    },
    [currentCompany, companies, exceptionsPaymentsPage, exceptionsInvoicesPage, exceptionsSearchPayments, exceptionsSearchInvoices, exceptionsLimit] // eslint-disable-line
  );

  // ── Go to reconcile for payment/invoice (from exceptions) ─────
  const goToReconcileForPayment = useCallback(
    (item) => {
      // Clear previous right-panel state upfront so stale data never shows.
      setActivePayId(null);
      activePayObjRef.current = null;
      setSelectedPayIds([]);
      setAllocations({});
      setInvoices([]);
      setCurrentTab('Reconcile');
      const pf = { party_type: item.party_type || 'Customer', party: item.party || '' };
      setPartyFilter(pf);
      // Pass pf explicitly — setPartyFilter is async so the closure in loadPayments
      // would otherwise still see the old (null) partyFilter value.
      loadPayments({
        keepPartyFilter: true,
        explicitPartyFilter: pf,
        ignoreDateFilter: true,
        callback: (newPays) => {
          const p = newPays.find((x) => x.id === item.name);
          if (p) {
            setActivePayId(payKey(p));
            activePayObjRef.current = p;
            setSelectedPayIds([payKey(p)]);
            loadInvoicesForPayment(p);
          }
        },
      });
    },
    [loadPayments, loadInvoicesForPayment] // eslint-disable-line
  );

  const goToReconcileForInvoice = useCallback(
    (item) => {
      // Clear previous right-panel state so stale invoices/allocations don't show.
      setActivePayId(null);
      activePayObjRef.current = null;
      setSelectedPayIds([]);
      setAllocations({});
      setInvoices([]);
      setCurrentTab('Reconcile');
      const pf = { party_type: item.party_type || 'Customer', party: item.party || '' };
      setPartyFilter(pf);
      const company = currentCompany || defaultCompany;
      // Pass pf explicitly for the same stale-closure reason.
      loadPayments({
        keepPartyFilter: true,
        explicitPartyFilter: pf,
        ignoreDateFilter: true,
        callback: (newPays) => {
          // If there are unmatched payments for this party, select the first one so the
          // right panel shows the normal reconcile view (not the "no payment" state).
          const first = newPays && newPays[0];
          if (first) {
            setActivePayId(payKey(first));
            activePayObjRef.current = first;
            setSelectedPayIds([payKey(first)]);
            loadInvoicesForPayment(first);
            return;
          }
          // No payments: still load outstanding invoices using the exception row account
          // so the user sees context (same as before).
          const account = item.receivable_payable_account || '';
          if (account) {
            loadInvoicesForPayment({
              company,
              party_type: item.party_type || 'Customer',
              party: item.party || '',
              receivable_payable_account: account,
              id: '',
            });
          }
        },
      });
    },
    [currentCompany, defaultCompany, loadPayments, loadInvoicesForPayment] // eslint-disable-line
  );

  // ── XCO modal ─────────────────────────────────────────────────
  const showXcoModal = useCallback(() => {
    const p = getPayByKey(activePayId);
    const invIds = Object.keys(allocations);
    const allInvs = invIds.map((id) => invoices.find((i) => i.id === id));
    const xcoInvs = allInvs.filter((i) => i?.xco);
    const sameCoInvs = allInvs.filter((i) => i && !i.xco);
    const total = allocTotal();

    // Fetch configured bridge accounts then open the modal with real account names.
    apiCall('matcha.api.payment_reconciliation.get_intercompany_accounts')
      .then((res) => {
        const bridgeMap = {};
        ((res?.message?.intercompany_accounts) || []).forEach((r) => {
          bridgeMap[r.company] = r.intercompany_account;
        });

        // Build one group of JV rows per xco company.
        // For the dialog we:
        //   - show each line in that account's own currency,
        //   - show FX separately in company base currency.
        const payExchangeRate = parseFloat(p?.source_exchange_rate || p?.target_exchange_rate || 1);
        const payCurrency = p?.paid_from_account_currency || p?.currency || '';
        const companyCurrencyLocal = dashboardStats?.company_currency || '';

        const jvRows = [];
        const sameCoAmount = sameCoInvs.reduce(
          (s, inv) => s + (parseFloat(allocations[inv.id]) || 0),
          0
        );
        const destCompanies = [...new Set(xcoInvs.map((i) => i.company))];
        destCompanies.forEach((destCo) => {
          const destInvs = xcoInvs.filter((i) => i.company === destCo);
          const foreignTotal = destInvs.reduce(
            (s, i) => s + (parseFloat(allocations[i.id]) || 0), 0
          );

          // Exchange rate on the invoice side
          const invExchangeRate = parseFloat(destInvs[0]?.exchange_rate || destInvs[0]?.conversion_rate || 1);

          const invCompanyCurrency = destInvs[0]?.company_currency || companyCurrencyLocal;
          const invInvoiceCurrency = destInvs[0]?.currency || payCurrency;

          const isMultiCurrency = payCurrency && companyCurrencyLocal && payCurrency !== companyCurrencyLocal;
          const payBase = isMultiCurrency ? foreignTotal * payExchangeRate : foreignTotal;
          const invBase = isMultiCurrency ? foreignTotal * invExchangeRate : foreignTotal;
          const fxDiffBase = payBase - invBase;

          const payBridge = bridgeMap[p?.company] || '(bridge — configure in Matcha Settings)';
          const invBridge = bridgeMap[destCo] || '(bridge — configure in Matcha Settings)';
          const payAR = p?.receivable_payable_account || 'Accounts Receivable';
          const invAR = destInvs[0]?.xco_receivable_payable_account || 'Accounts Receivable';
          const fxAccount = p?.fx_account || 'Exchange Gain/Loss';

          // Payment company AR: account currency = payment currency, amount in foreign (invoice) currency.
          // Payment company bridge: account currency = payment company base, amount in base.
          jvRows.push(
            { company: p?.company, dr: 'Dr', account: payAR, amt: foreignTotal, currency: payCurrency },
            { company: p?.company, dr: 'Cr', account: payBridge, amt: invBase, currency: companyCurrencyLocal },
          );
          if (Math.abs(fxDiffBase) >= 0.01) {
            const fxLabel = fxDiffBase > 0 ? 'FX gain' : 'FX loss';
            jvRows.push({
              company: p?.company,
              dr: fxDiffBase > 0 ? 'Cr' : 'Dr',
              account: fxAccount,
              amt: Math.abs(fxDiffBase),
              currency: companyCurrencyLocal,
              note: fxLabel,
            });
          }
          // Invoice company bridge: base currency; debtor: invoice currency.
          jvRows.push(
            { company: destCo, dr: 'Dr', account: invBridge, amt: invBase, currency: invCompanyCurrency },
            { company: destCo, dr: 'Cr', account: invAR, amt: foreignTotal, currency: invInvoiceCurrency },
          );
        });

        setXcoModal((m) => ({
          ...m,
          open: true,
          from: p?.company || '',
          dest: destCompanies.join(', '),
          total,
          currency: p?.currency || '',
          jvRows,
          hasSameCompany: sameCoAmount > 0,
          sameCompanyAmount: sameCoAmount,
          reconciling: false,
        }));
      });
  }, [activePayId, allocations, invoices]); // eslint-disable-line

  // ── Computed / derived ────────────────────────────────────────
  function getFilteredPayments() {
    let data = payments.slice();
    if (partyFilter?.party_type && partyFilter?.party) {
      data = data.filter(
        (p) =>
          (p.party_type || '') === partyFilter.party_type &&
          (p.party || '') === partyFilter.party
      );
    }
    if (filterMode === 'in') data = data.filter((p) => p.dir === 'in');
    if (filterMode === 'out') data = data.filter((p) => p.dir === 'out');
    if (searchQ && !partyFilter?.party) {
      data = data.filter(
        (p) =>
          (p.party || '').toLowerCase().includes(searchQ) ||
          (p.id || '').toLowerCase().includes(searchQ) ||
          String(p.amount).includes(searchQ)
      );
    }
    return data;
  }

  return (
    <AppContext.Provider
      value={{
        // Boot
        companies,
        defaultCompany,
        currencySymbols,
        currencySymbolOnRight,

        // Data
        payments,
        invoices,

        // Selection
        activePayId,
        selectedPayIds,
        partyFilter,
        allocations,
        trayExpanded,
        setTrayExpanded,

        // Filters
        filterMode,
        setFilterMode,
        searchQ,
        invoiceSearchQ,
        setInvoiceSearchQ,
        invoiceFromDate,
        setInvoiceFromDate,
        invoiceToDate,
        setInvoiceToDate,

        // Company / date
        currentCompany,
        dateFilter,
        customFromDate,
        customToDate,

        // Loading
        loadingPayments,
        loadingInvoices,
        loadingMorePayments,
        loadingMoreInvoices,

        // Pagination
        paymentsHasMore,
        invoicesHasMore,
        totalPaymentsCount,
        dashboardStats,

        // Tab
        currentTab,
        setCurrentTab,

        // History
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

        // Exceptions
        exceptionsLoading,
        exceptionsPayments,
        exceptionsInvoices,
        exceptionsTotalPayments,
        exceptionsTotalInvoices,
        exceptionsTotalInSystem,
        exceptionsPaymentsPage,
        setExceptionsPaymentsPage,
        exceptionsInvoicesPage,
        setExceptionsInvoicesPage,
        exceptionsSearchPayments,
        setExceptionsSearchPayments,
        exceptionsSearchInvoices,
        setExceptionsSearchInvoices,
        exceptionsLimit,
        exceptionsSiSummary,
        exceptionsPiSummary,
        exceptionsPaySummary,

        // Modals
        xcoModal,
        setXcoModal,
        undoModal,
        setUndoModal,
        historyViewModal,
        setHistoryViewModal,

        // Toasts
        toasts,

        // Company currency (always company base currency, used for FX amounts)
        companyCurrency: dashboardStats?.company_currency || '',

        // FX
        invFxMap: invFxMapRef.current,
        paymentFxMap: paymentFxMapRef.current,
        invPaymentFxMap: invPaymentFxMapRef.current,
        invAgainstMap: invAgainstMapRef.current,
        fxVersion,

        // Refs
        currentPayListIdsRef,

        // Actions
        toast,
        loadPayments,
        loadMorePayments,
        loadInvoicesForPayment,
        loadMoreInvoices,
        selectPayment,
        selectAllPayments,
        clearPaymentSelection,
        clearPartyFilter,
        filterPayments,
        toggleInvoice,
        updateAlloc,
        selectAllInvoices,
        clearTray,
        doReconcile,
        showXcoModal,
        changeCompany,
        changeDateFilter,
        loadHistory,
        undoReconciliation,
        confirmUndo,
        loadExceptions,
        goToReconcileForPayment,
        goToReconcileForInvoice,
        refreshFxPreview,
        buildInvAgainstMap,

        // Helpers
        payKey,
        getPayByKey: (key) => getPayByKey(key),
        getPaymentInvoices,
        applyInvoiceFilters,
        getFilteredPayments,
        allocTotal: () => allocTotal(),
        selectedPaymentsTotal: () => selectedPaymentsTotal(),
        remaining: (pay) => remaining(pay),
        buildAllocationList: () => buildAllocationList(),
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
