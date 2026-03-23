/* global React, ReactDOM, frappe */

// Lightweight React SPA for Matcha bank reconciliation.
// Uses the public Matcha APIs where available and mock data for
// advanced panels so the full UX can be explored before wiring
// all backend flows.

const { useEffect, useMemo, useState } = React;

function h(tag, props, ...children) {
  return React.createElement(tag, props || null, ...children);
}

function fetchJSON(method, args = {}) {
  return new Promise((resolve, reject) => {
    frappe.call({
      method,
      args,
      callback: (r) => {
        if (r.exc) {
          reject(r.exc);
        } else {
          resolve(r.message);
        }
      },
      error: reject,
    });
  });
}

function computeStatus(tx) {
  const allocated = tx.allocated_amount || 0;
  const unallocated = tx.unallocated_amount || 0;
  if (allocated === 0) return "Not Reconciled";
  if (allocated > 0 && unallocated !== 0) return "Partially Reconciled";
  return "Reconciled";
}

function getStatusClass(status) {
  if (status === "Not Reconciled") return "matcha-status-pill matcha-status-not";
  if (status === "Partially Reconciled") return "matcha-status-pill matcha-status-partial";
  return "matcha-status-pill matcha-status-full";
}

function getMockSuggestions(tx) {
  if (!tx) return [];
  const amount = tx.withdrawal || tx.deposit || 0;
  const base = Math.abs(amount);
  return [
    {
      id: `${tx.name}-1`,
      label: "Likely invoice match",
      reference: "INV-" + String(tx.name).slice(-6),
      amount: base,
      confidence: "High",
      type: "Payment Entry",
    },
    {
      id: `${tx.name}-2`,
      label: "Bank charges rule",
      reference: "Bank Charges",
      amount: Math.round(base * 0.02 * 100) / 100,
      confidence: "Medium",
      type: "Journal Entry",
    },
  ];
}

function MatchaApp() {
  const [bankAccount, setBankAccount] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeFullyReconciled, setIncludeFullyReconciled] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [closingBalanceAsPerBank, setClosingBalanceAsPerBank] = useState("");
  const [clearedBalance, setClearedBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  async function loadTransactions() {
    if (!bankAccount) {
      setTransactions([]);
      setSelectedId(null);
      setSelectedIds([]);
      setFocusedIndex(-1);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchJSON("matcha.api.transactions.list_bank_transactions", {
        bank_account: bankAccount,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        include_fully_reconciled: includeFullyReconciled,
      });
      const list = Array.isArray(data) ? data : [];
      setTransactions(list);
      if (list.length) {
        setFocusedIndex(0);
        setSelectedId(list[0].name);
      } else {
        setFocusedIndex(-1);
        setSelectedId(null);
      }
      const company = list.length && list[0].company ? list[0].company : null;
      if (bankAccount && (toDate || fromDate) && company) {
        setBalanceLoading(true);
        try {
          const till = toDate || fromDate;
          const balance = await fetchJSON("matcha.api.transactions.get_account_balance", {
            bank_account: bankAccount,
            till_date: till,
            company: company,
          });
          setClearedBalance(balance != null ? Number(balance) : null);
        } catch (err) {
          setClearedBalance(null);
        } finally {
          setBalanceLoading(false);
        }
      } else {
        setClearedBalance(null);
      }
    } catch (e) {
      setError("Failed to load transactions");
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function pushHistory(entry) {
    setHistoryItems((prev) => [
      {
        id: prev.length + 1,
        ts: new Date().toISOString(),
        ...entry,
      },
      ...prev,
    ]);
  }

  function handleMockAction(actionType) {
    if (!selectedId && selectedIds.length === 0) return;
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
    pushHistory({
      type: actionType,
      transactionIds: ids,
      note: `Mock ${actionType} triggered from UI`,
    });
    frappe.show_alert &&
      frappe.show_alert({
        message: `${actionType} (mock) queued for ${ids.length} transaction(s)`,
        indicator: "blue",
      });
  }

  const filtered = useMemo(
    () =>
      transactions.filter((tx) => {
        const text = (tx.description || tx.reference_number || "").toLowerCase();
        if (search && !text.includes(search.toLowerCase())) {
          return false;
        }

        if (typeFilter === "Debits" && tx.deposit && tx.deposit > 0) {
          return false;
        }
        if (typeFilter === "Credits" && tx.withdrawal && tx.withdrawal > 0) {
          return false;
        }

        if (statusFilter !== "All") {
          const status = computeStatus(tx);
          if (statusFilter === "Reconciled" && status !== "Reconciled") return false;
          if (statusFilter === "Unreconciled" && status !== "Not Reconciled") return false;
          if (statusFilter === "Partially Reconciled" && status !== "Partially Reconciled")
            return false;
        }

        return true;
      }),
    [transactions, search, typeFilter, statusFilter]
  );

  const selectedTx =
    selectedId && filtered.find((tx) => tx.name === selectedId)
      ? filtered.find((tx) => tx.name === selectedId)
      : filtered[0] || null;

  useEffect(() => {
    function handleKeyDown(ev) {
      const key = ev.key.toLowerCase();
      if ((ev.metaKey || ev.ctrlKey) && key === "r") {
        ev.preventDefault();
        loadTransactions();
        return;
      }
      if ((ev.metaKey || ev.ctrlKey) && key === "z") {
        ev.preventDefault();
        setHistoryOpen((open) => !open);
        return;
      }

      if (!filtered.length) return;

      if (key === "j" || ev.key === "ArrowDown") {
        ev.preventDefault();
        setFocusedIndex((idx) => {
          const next = Math.min((idx < 0 ? 0 : idx) + 1, filtered.length - 1);
          setSelectedId(filtered[next].name);
          return next;
        });
      } else if (key === "k" || ev.key === "ArrowUp") {
        ev.preventDefault();
        setFocusedIndex((idx) => {
          const next = Math.max((idx < 0 ? 0 : idx) - 1, 0);
          setSelectedId(filtered[next].name);
          return next;
        });
      } else if (key === " ") {
        // space toggles selection of focused row
        ev.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filtered.length) {
          toggleSelect(filtered[focusedIndex].name);
        }
      } else if (key === "1") {
        ev.preventDefault();
        handleMockAction("Record Payment");
      } else if (key === "2") {
        ev.preventDefault();
        handleMockAction("Bank Entry");
      } else if (key === "3") {
        ev.preventDefault();
        handleMockAction("Internal Transfer");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, focusedIndex, selectedId, selectedIds]);

  function renderFilters() {
    return h(
      "div",
      { className: "matcha-filters flex flex-wrap items-end" },
      h(
        "div",
        { className: "matcha-field", style: { minWidth: "160px" } },
        h("label", null, "Bank Account"),
        h("input", {
          type: "text",
          value: bankAccount,
          onChange: (e) => setBankAccount(e.target.value),
          placeholder: "BANK-ACC-0001",
        })
      ),
      h(
        "div",
        { className: "matcha-field", style: { minWidth: "130px" } },
        h("label", null, "From Date"),
        h("input", {
          type: "date",
          value: fromDate,
          onChange: (e) => setFromDate(e.target.value),
        })
      ),
      h(
        "div",
        { className: "matcha-field", style: { minWidth: "130px" } },
        h("label", null, "To Date"),
        h("input", {
          type: "date",
          value: toDate,
          onChange: (e) => setToDate(e.target.value),
        })
      ),
      h(
        "label",
        { className: "matcha-field", style: { display: "flex", alignItems: "center", gap: "0.35rem" } },
        h("input", {
          type: "checkbox",
          checked: includeFullyReconciled,
          onChange: (e) => setIncludeFullyReconciled(e.target.checked),
        }),
        "Include fully reconciled"
      ),
      h(
        "div",
        { className: "matcha-field", style: { minWidth: "160px" } },
        h("label", null, "Search"),
        h("input", {
          type: "text",
          value: search,
          onChange: (e) => setSearch(e.target.value),
          placeholder: "Description or reference…",
        })
      ),
      h(
        "div",
        { className: "matcha-field", style: { minWidth: "120px" } },
        h("label", null, "Type"),
        h(
          "select",
          {
            value: typeFilter,
            onChange: (e) => setTypeFilter(e.target.value),
          },
          ["All", "Debits", "Credits"].map((opt) => h("option", { key: opt, value: opt }, opt))
        )
      ),
      h(
        "div",
        { className: "matcha-field", style: { minWidth: "150px" } },
        h("label", null, "Status"),
        h(
          "select",
          {
            value: statusFilter,
            onChange: (e) => setStatusFilter(e.target.value),
          },
          ["All", "Reconciled", "Unreconciled", "Partially Reconciled"].map((opt) =>
            h("option", { key: opt, value: opt }, opt)
          )
        )
      ),
      h(
        "button",
        {
          type: "button",
          onClick: loadTransactions,
          className: "btn btn-primary",
          disabled: loading,
          style: { marginLeft: "auto" },
        },
        loading ? "Loading…" : "Load"
      )
    );
  }

  function renderTable() {
    return h(
      "div",
      { className: "matcha-table-wrapper", style: { marginTop: "0.75rem" } },
      h(
        "table",
        { className: "matcha-table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            ["", "Date", "Description", "Debit", "Credit", "Unallocated", "Status", "Actions"].map(
              (hLabel) => h("th", { key: hLabel }, hLabel)
            )
          )
        ),
        h(
          "tbody",
          null,
          !filtered.length &&
            h(
              "tr",
              null,
              h(
                "td",
                { colSpan: 8, className: "text-center text-muted" },
                bankAccount ? "No transactions found." : "Select a bank account to begin."
              )
            ),
          filtered.map((tx, index) => {
            const status = computeStatus(tx);
            const isSelectedRow = selectedId === tx.name;
            const isChecked = selectedIds.includes(tx.name);
            return h(
              "tr",
              {
                key: tx.name,
                className: isSelectedRow ? "matcha-table-row-selected" : "",
                onClick: () => {
                  setSelectedId(tx.name);
                  setFocusedIndex(index);
                },
              },
              h(
                "td",
                null,
                h("input", {
                  type: "checkbox",
                  checked: isChecked,
                  onChange: (e) => {
                    e.stopPropagation();
                    toggleSelect(tx.name);
                  },
                })
              ),
              h("td", null, tx.date),
              h(
                "td",
                { style: { maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis" } },
                tx.description || tx.reference_number || ""
              ),
              h("td", null, tx.withdrawal || ""),
              h("td", null, tx.deposit || ""),
              h("td", null, tx.unallocated_amount || ""),
              h("td", null, h("span", { className: getStatusClass(status) }, status)),
              h(
                "td",
                null,
                h(
                  "div",
                  { className: "d-flex gap-1" },
                  h(
                    "a",
                    {
                      href: `/app/bank-transaction/${tx.name}`,
                      target: "_blank",
                      rel: "noreferrer",
                      className: "btn btn-link btn-sm p-0",
                    },
                    "View"
                  )
                )
              )
            );
          })
        )
      )
    );
  }

  function renderBulkBar() {
    const count = selectedIds.length || (selectedId ? 1 : 0);
    if (!count) return null;

    return h(
      "div",
      { className: "matcha-actions-bar" },
      h("div", null, `${count} transaction(s) selected`),
      h(
        "div",
        null,
        h(
          "button",
          {
            type: "button",
            className: "btn btn-sm btn-outline-secondary",
            onClick: () => handleMockAction("Record Payment"),
          },
          "Record payment (1)"
        ),
        h(
          "button",
          {
            type: "button",
            className: "btn btn-sm btn-outline-secondary",
            onClick: () => handleMockAction("Bank Entry"),
          },
          "Bank entry (2)"
        ),
        h(
          "button",
          {
            type: "button",
            className: "btn btn-sm btn-outline-secondary",
            onClick: () => handleMockAction("Internal Transfer"),
          },
          "Transfer (3)"
        ),
        h(
          "button",
          {
            type: "button",
            className: "btn btn-sm btn-link",
            onClick: clearSelection,
          },
          "Clear"
        )
      )
    );
  }

  function renderSummaryCards() {
    const bankVal = closingBalanceAsPerBank === "" ? null : parseFloat(closingBalanceAsPerBank);
    const cleared = clearedBalance != null ? clearedBalance : null;
    const diff =
      bankVal != null && cleared != null ? bankVal - cleared : null;
    const diffZero = diff !== null && Math.abs(diff) < 0.01;
    return h(
      "div",
      {
        className: "matcha-summary-cards",
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "0.75rem",
          marginTop: "1rem",
          marginBottom: "0.5rem",
        },
      },
      h(
        "div",
        { className: "matcha-details-card" },
        h("div", { className: "matcha-details-title", style: { fontSize: "0.8rem" } }, "Closing balance (bank statement)"),
        h(
          "input",
          {
            type: "number",
            step: "0.01",
            placeholder: "Enter from statement",
            value: closingBalanceAsPerBank,
            onChange: (e) => setClosingBalanceAsPerBank(e.target.value),
            className: "input",
            style: { marginTop: "0.25rem", width: "100%", maxWidth: "180px" },
          }
        )
      ),
      h(
        "div",
        { className: "matcha-details-card" },
        h("div", { className: "matcha-details-title", style: { fontSize: "0.8rem" } }, "Closing balance (ERP)"),
        h(
          "div",
          { style: { marginTop: "0.25rem", fontWeight: 600 } },
          balanceLoading ? "…" : cleared != null ? String(cleared) : "—"
        )
      ),
      h(
        "div",
        { className: "matcha-details-card" },
        h("div", { className: "matcha-details-title", style: { fontSize: "0.8rem" } }, "Difference"),
        h(
          "div",
          {
            style: {
              marginTop: "0.25rem",
              fontWeight: 600,
              color: diff !== null ? (diffZero ? "#166534" : "#b91c1c") : "#6b7280",
            },
          },
          diff !== null ? String(diff.toFixed(2)) : "—"
        )
      )
    );
  }

  function renderListRegion() {
    return h(
      "div",
      null,
      renderFilters(),
      error && h("div", { className: "text-red-600 text-sm", style: { marginTop: "0.5rem" } }, error),
      renderSummaryCards(),
      renderTable(),
      renderBulkBar()
    );
  }

  function renderDetailsRegion() {
    const container = document.getElementById("matcha-root-details");
    if (!container) return;

    const tx = selectedTx;
    if (!tx) {
      ReactDOM.createRoot(container).render(
        h(
          "div",
          { className: "matcha-details-card" },
          h("div", { className: "matcha-details-title" }, "No transaction selected"),
          h(
            "p",
            { style: { fontSize: "0.78rem", marginBottom: 0 } },
            "Use the arrows or J/K keys to move through transactions, then press enter to open details."
          )
        )
      );
      return;
    }

    const status = computeStatus(tx);
    const suggestions = getMockSuggestions(tx);

    ReactDOM.createRoot(container).render(
      h(
        "div",
        { className: "space-y-3" },
        h(
          "div",
          { className: "matcha-details-card" },
          h("div", { className: "matcha-details-title" }, "Transaction details"),
          h(
            "div",
            { className: "matcha-details-row" },
            h("span", { className: "matcha-pill-muted" }, "Date"),
            h("span", null, tx.date)
          ),
          h(
            "div",
            { className: "matcha-details-row" },
            h("span", { className: "matcha-pill-muted" }, "Amount"),
            h(
              "span",
              null,
              (tx.withdrawal || tx.deposit || 0) + (tx.currency ? " " + tx.currency : "")
            )
          ),
          h(
            "div",
            { className: "matcha-details-row" },
            h("span", { className: "matcha-pill-muted" }, "Unallocated"),
            h("span", null, tx.unallocated_amount || 0)
          ),
          h(
            "div",
            { className: "matcha-details-row" },
            h("span", { className: "matcha-pill-muted" }, "Status"),
            h("span", { className: getStatusClass(status) }, status)
          ),
          h(
            "div",
            { className: "matcha-details-row" },
            h("span", { className: "matcha-pill-muted" }, "Description"),
            h("span", { style: { maxWidth: "180px", textAlign: "right" } }, tx.description || "—")
          )
        ),
        h(
          "div",
          { className: "matcha-details-card" },
          h("div", { className: "matcha-details-title" }, "Suggested matches (mock)"),
          suggestions.map((s) =>
            h(
              "div",
              {
                key: s.id,
                style: {
                  padding: "0.35rem 0.45rem",
                  borderRadius: "0.5rem",
                  border: "1px dashed #e5e7eb",
                  marginBottom: "0.25rem",
                  background: "#fff",
                },
              },
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "0.1rem",
                    fontSize: "0.78rem",
                  },
                },
                h("span", null, s.label),
                h(
                  "span",
                  { className: "matcha-badge" },
                  s.type,
                  " · ",
                  h("span", { style: { marginLeft: "0.15rem" } }, s.confidence)
                )
              ),
              h(
                "div",
                { className: "matcha-details-row" },
                h("span", { className: "matcha-pill-muted" }, "Ref"),
                h("span", null, s.reference)
              ),
              h(
                "div",
                { className: "matcha-details-row" },
                h("span", { className: "matcha-pill-muted" }, "Amount"),
                h("span", null, s.amount)
              )
            )
          ),
          h(
            "p",
            { style: { fontSize: "0.72rem", marginTop: "0.25rem", color: "#6b7280" } },
            "These are mock suggestions so you can iterate on UX before connecting real rules or AI."
          )
        ),
        h(
          "div",
          { className: "matcha-details-card" },
          h("div", { className: "matcha-details-title" }, "Quick actions (mock)"),
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: "0.4rem" } },
            h(
              "button",
              {
                type: "button",
                className: "btn btn-sm btn-outline-secondary",
                onClick: () => handleMockAction("Record Payment"),
              },
              "Record payment"
            ),
            h(
              "button",
              {
                type: "button",
                className: "btn btn-sm btn-outline-secondary",
                onClick: () => handleMockAction("Bank Entry"),
              },
              "Bank entry"
            ),
            h(
              "button",
              {
                type: "button",
                className: "btn btn-sm btn-outline-secondary",
                onClick: () => handleMockAction("Internal Transfer"),
              },
              "Internal transfer"
            ),
            h(
              "a",
              {
                href: `/app/bank-transaction/${tx.name}`,
                target: "_blank",
                rel: "noreferrer",
                className: "btn btn-sm btn-link",
              },
              "Open full document"
            )
          )
        ),
        historyOpen &&
          h(
            "div",
            { className: "matcha-details-card" },
            h("div", { className: "matcha-details-title" }, "Session history (mock)"),
            !historyItems.length &&
              h(
                "p",
                { style: { fontSize: "0.75rem", marginBottom: 0 } },
                "Actions you take here will appear as a timeline so you can design the undo UX."
              ),
            historyItems.map((item) =>
              h(
                "div",
                {
                  key: item.id,
                  style: {
                    borderBottom: "1px solid #e5e7eb",
                    paddingBottom: "0.25rem",
                    marginBottom: "0.25rem",
                    fontSize: "0.75rem",
                  },
                },
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.1rem",
                    },
                  },
                  h("span", null, item.type),
                  h("span", { className: "matcha-pill-muted" }, new Date(item.ts).toLocaleTimeString())
                ),
                h(
                  "div",
                  null,
                  "Transactions: ",
                  (item.transactionIds || []).join(", ")
                ),
                item.note &&
                  h("div", { className: "matcha-pill-muted", style: { marginTop: "0.05rem" } }, item.note)
              )
            )
          )
      )
    );
  }

  useEffect(() => {
    renderDetailsRegion();
  }, [selectedTx, historyOpen, historyItems]);

  return renderListRegion();
}

document.addEventListener("DOMContentLoaded", () => {
  const listRoot = document.getElementById("matcha-root-list");
  if (listRoot) {
    ReactDOM.createRoot(listRoot).render(h(MatchaApp));
  }
});

