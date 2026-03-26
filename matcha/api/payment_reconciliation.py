# Copyright (c) 2025, Negentropy Solutions and contributors
# For license information, please see license.txt

"""
Payment reconciliation APIs for Matcha.

Uses ERPNext Payment Reconciliation logic: get unallocated payment entries
and outstanding invoices per party, then allocate and reconcile via
erpnext.accounts.doctype.payment_reconciliation.payment_reconciliation.
"""

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate
from frappe.query_builder import Case
from pypika import Order
from pypika import Criterion

import erpnext
from erpnext.accounts.utils import get_outstanding_invoices


@frappe.whitelist(methods=["GET"])
def get_intercompany_accounts() -> dict:
    """Return the intercompany bridge accounts configured in Matcha Settings."""
    from matcha.matcha.doctype.matcha_settings.matcha_settings import MatchaSettings
    settings = MatchaSettings.get_settings()
    rows = [
        {"company": r.company, "intercompany_account": r.intercompany_account}
        for r in (settings.intercompany_accounts or [])
    ]
    return {"intercompany_accounts": rows}


@frappe.whitelist(methods=["GET"])
def get_dashboard_stats(
    company: str,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    """
    Lightweight dashboard stats for the left summary cards.
    Counts are company-scoped and respect the date range if provided.
    """
    if not company:
        frappe.throw(_("Company is required"))

    # Open invoices: count of Sales + Purchase invoices with outstanding > 0
    inv_date_filter = {}
    if from_date and to_date:
        inv_date_filter["posting_date"] = ("between", [from_date, to_date])
    elif from_date:
        inv_date_filter["posting_date"] = (">=", from_date)
    elif to_date:
        inv_date_filter["posting_date"] = ("<=", to_date)

    si_filters = {
        "company": company,
        "docstatus": 1,
        "is_return": 0,
        "outstanding_amount": (">", 0),
        **inv_date_filter,
    }
    pi_filters = {
        "company": company,
        "docstatus": 1,
        "is_return": 0,
        "outstanding_amount": (">", 0),
        **inv_date_filter,
    }
    open_invoices = (frappe.db.count("Sales Invoice", filters=si_filters) or 0) + (
        frappe.db.count("Purchase Invoice", filters=pi_filters) or 0
    )

    # Overdue invoices: outstanding invoices whose due_date is in the past (as of today).
    # Intentionally NOT filtered by the user date range — overdue is always "as of today"
    # and is a separate urgency signal from the date-scoped open invoice count.
    _today_str = nowdate()
    overdue_si = frappe.db.count(
        "Sales Invoice",
        filters={
            "company": company,
            "docstatus": 1,
            "is_return": 0,
            "outstanding_amount": (">", 0),
            "due_date": ("<", _today_str),
        },
    ) or 0
    overdue_pi = frappe.db.count(
        "Purchase Invoice",
        filters={
            "company": company,
            "docstatus": 1,
            "is_return": 0,
            "outstanding_amount": (">", 0),
            "due_date": ("<", _today_str),
        },
    ) or 0
    overdue_invoices = int(overdue_si) + int(overdue_pi)

    # Unmatched value: total unallocated amount in Payment Entries, expressed in
    # COMPANY BASE currency. v15's Payment Entry doesn't have base_unallocated_amount,
    # so compute base using the stored exchange rates:
    #   - Receive:  base = unallocated_amount * source_exchange_rate
    #   - Pay:      base = unallocated_amount * target_exchange_rate
    uv_date_clause = ""
    uv_params: list = [company]
    if from_date and to_date:
        uv_date_clause = "AND posting_date BETWEEN %s AND %s"
        uv_params += [from_date, to_date]
    elif from_date:
        uv_date_clause = "AND posting_date >= %s"
        uv_params.append(from_date)
    elif to_date:
        uv_date_clause = "AND posting_date <= %s"
        uv_params.append(to_date)

    unmatched_value_result = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(
          CASE
            WHEN payment_type = 'Receive'
              THEN unallocated_amount * COALESCE(source_exchange_rate, 1)
            ELSE unallocated_amount * COALESCE(target_exchange_rate, 1)
          END
        ), 0) AS total
        FROM `tabPayment Entry`
        WHERE company = %s
          AND docstatus = 1
          AND unallocated_amount > 0
          {uv_date_clause}
        """,
        uv_params,
        as_dict=True,
    )
    unmatched_value = float((unmatched_value_result[0].get("total") or 0) if unmatched_value_result else 0)

    # Company currency for formatting on the frontend
    company_currency = frappe.db.get_value("Company", company, "default_currency") or "USD"

    return {
        "open_invoices": int(open_invoices),
        "overdue_invoices": overdue_invoices,
        "unmatched_value": unmatched_value,
        "company_currency": company_currency,
    }


def _payment_row(
    id_,
    party_type,
    party,
    amount,
    date,
    ref,
    dir_,
    company,
    note,
    currency,
    receivable_payable_account,
    reference_type="Payment Entry",
    reference_row=None,
    exchange_rate=None,
    paid_from_account_currency=None,
):
    return {
        "id": id_,
        "reference_type": reference_type,
        "reference_row": reference_row,
        "party_type": party_type,
        "party": party,
        "amount": float(amount or 0),
        "date": date,
        "ref": ref or "",
        "dir": dir_,
        "company": company,
        "note": note or "",
        "currency": currency or "",
        "receivable_payable_account": receivable_payable_account,
        "source_exchange_rate": float(exchange_rate or 1),
        "paid_from_account_currency": paid_from_account_currency or currency or "",
    }


def _get_jv_payments(company, party_type, party, account, from_date, to_date, limit):
    """Return Journal Entry rows as payment-like entries (same party/account, unallocated)."""
    # Defensive: some callers may pass a single-item list/tuple for account.
    if isinstance(account, list | tuple | set):
        account = next(iter(account)) if len(account) == 1 else None
    if not isinstance(account, str) or not account:
        return []

    je = frappe.qb.DocType("Journal Entry")
    jea = frappe.qb.DocType("Journal Entry Account")
    try:
        account_type = erpnext.get_party_account_type(party_type)
    except Exception:
        return []
    if account_type == "Receivable":
        dr_or_cr = jea.credit_in_account_currency - jea.debit_in_account_currency
    elif account_type == "Payable":
        dr_or_cr = jea.debit_in_account_currency - jea.credit_in_account_currency
    else:
        return []

    conditions = [
        je.docstatus == 1,
        jea.party_type == party_type,
        jea.party == party,
        jea.account == account,
        dr_or_cr > 0,
        (jea.reference_type == "")
        | (jea.reference_type.isnull())
        | (jea.reference_type.isin(("Sales Order", "Purchase Order"))),
    ]
    if from_date:
        conditions.append(je.posting_date >= from_date)
    if to_date:
        conditions.append(je.posting_date <= to_date)

    q = (
        frappe.qb.from_(je)
        .inner_join(jea)
        .on(jea.parent == je.name)
        .select(
            je.name.as_("reference_name"),
            je.posting_date,
            je.remark.as_("remarks"),
            jea.name.as_("reference_row"),
            dr_or_cr.as_("amount"),
            jea.account_currency.as_("currency"),
        )
        .where(Criterion.all(conditions))
        .orderby(je.posting_date, order=Order.desc)
    )
    if limit:
        q = q.limit(limit)
    rows = q.run(as_dict=True)

    currency = frappe.get_cached_value("Account", account, "account_currency") or ""
    out = []
    for r in rows:
        out.append(
            _payment_row(
                id_=r.reference_name,
                party_type=party_type,
                party=party,
                amount=r.amount,
                date=r.posting_date,
                ref=r.remarks or "",
                dir_="in" if account_type == "Receivable" else "out",
                company=company,
                note=r.remarks or "",
                currency=r.currency or currency,
                receivable_payable_account=account,
                reference_type="Journal Entry",
                reference_row=r.reference_row,
            )
        )
    return out


def _get_all_jv_payments(company, from_date, to_date, limit):
    """
    Return Journal Entry rows (company-wide) as payment-like entries.
    Mirrors ERPNext Payment Reconciliation: JV with receivable/payable account rows
    and unallocated-looking rows (reference_type empty or SO/PO) are shown alongside Payment Entries.
    """
    je = frappe.qb.DocType("Journal Entry")
    jea = frappe.qb.DocType("Journal Entry Account")
    acc = frappe.qb.DocType("Account")

    # Amount available to allocate: Receivable = credit - debit, Payable = debit - credit
    dr_or_cr = (
        Case()
        .when(
            acc.account_type == "Receivable",
            jea.credit_in_account_currency - jea.debit_in_account_currency,
        )
        .else_(jea.debit_in_account_currency - jea.credit_in_account_currency)
    )

    conditions = [
        je.docstatus == 1,
        je.company == company,
        jea.account == acc.name,
        acc.account_type.isin(("Receivable", "Payable")),
        jea.party_type.isnotnull(),
        jea.party != "",
        dr_or_cr > 0,
        (jea.reference_type == "")
        | (jea.reference_type.isnull())
        | (jea.reference_type.isin(("Sales Order", "Purchase Order"))),
    ]
    if from_date:
        conditions.append(je.posting_date >= from_date)
    if to_date:
        conditions.append(je.posting_date <= to_date)

    q = (
        frappe.qb.from_(je)
        .inner_join(jea)
        .on(jea.parent == je.name)
        .inner_join(acc)
        .on(jea.account == acc.name)
        .select(
            je.name.as_("reference_name"),
            je.posting_date,
            je.remark.as_("remarks"),
            jea.name.as_("reference_row"),
            jea.party_type,
            jea.party,
            jea.account,
            dr_or_cr.as_("amount"),
            jea.account_currency.as_("currency"),
            acc.account_type.as_("account_type"),
        )
        .where(Criterion.all(conditions))
        .orderby(je.posting_date, order=Order.desc)
    )
    if limit:
        q = q.limit(limit)
    rows = q.run(as_dict=True)

    out = []
    seen = set()
    for r in rows:
        key = (r.reference_name, r.reference_row)
        if key in seen:
            continue
        seen.add(key)
        is_receivable = (r.account_type or "").strip() == "Receivable"
        out.append(
            _payment_row(
                id_=r.reference_name,
                party_type=r.party_type or "",
                party=r.party or "",
                amount=r.amount,
                date=r.posting_date,
                ref=r.remarks or "",
                dir_="in" if is_receivable else "out",
                company=company,
                note=r.remarks or "",
                currency=r.currency or "",
                receivable_payable_account=r.account or "",
                reference_type="Journal Entry",
                reference_row=r.reference_row,
            )
        )
    return out


@frappe.whitelist(methods=["GET"])
def get_payments(
    company: str,
    party_type: str | None = None,
    party: str | None = None,
    search: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    limit: int = 50,
    offset: int = 0,
    include_count: bool = False,
) -> list[dict]:
    """
    Return Payment Entries (and when party is set, Journal Entries) with unallocated amount.
    Supports all party types (Customer, Supplier, Employee, Shareholder, etc.).
    When party is provided, list is filtered to that party and JV entries are included.
    """
    if not company:
        frappe.throw(_("Company is required"))

    pe = frappe.qb.DocType("Payment Entry")
    q = (
        frappe.qb.from_(pe)
        .select(
            pe.name,
            pe.party_type,
            pe.party,
            pe.unallocated_amount,
            pe.posting_date,
            pe.reference_no,
            pe.payment_type,
            pe.paid_from,
            pe.paid_to,
            pe.paid_from_account_currency,
            pe.paid_to_account_currency,
            pe.source_exchange_rate,
            pe.target_exchange_rate,
            pe.remarks,
            pe.company,
        )
        .where(pe.docstatus == 1)
        .where(pe.unallocated_amount > 0)
        .where(pe.company == company)
        .orderby(pe.posting_date, order=Order.desc)
    )

    if party_type:
        q = q.where(pe.party_type == party_type)
    if party:
        q = q.where(pe.party == party)
    # Same as ERPNext Payment Reconciliation: when party is not selected, do not show Employee/Shareholder
    # in the list (ERPNext always requires party + receivable_payable_account before loading payments).
    if not (party_type and party):
        q = q.where(pe.party_type.notin(["Employee", "Shareholder"]))
    # When party is selected: filter by party account and payment_type (get_common_query logic).
    if party_type in ("Employee", "Shareholder") and party:
        try:
            from erpnext.accounts.party import get_party_account
            party_account = get_party_account(party_type, party, company)
            if party_account:
                accounts_list = [party_account] if isinstance(party_account, str) else (party_account or [])
                if accounts_list:
                    account_type = frappe.db.get_value("Party Type", party_type, "account_type") or ""
                    expected_payment_type = "Receive" if account_type == "Receivable" else "Pay"
                    q = q.where(pe.payment_type == expected_payment_type)
                    if expected_payment_type == "Receive":
                        q = q.where(pe.paid_from.isin(accounts_list))
                    else:
                        q = q.where(pe.paid_to.isin(accounts_list))
        except Exception:
            pass
    if search:
        s = f"%{search.strip()}%"
        q = q.where(
            (pe.party.like(s))
            | (pe.name.like(s))
            | (pe.reference_no.like(s))
        )
    if from_date:
        q = q.where(pe.posting_date >= from_date)
    if to_date:
        q = q.where(pe.posting_date <= to_date)
    if offset:
        q = q.offset(int(offset))
    if limit:
        q = q.limit(int(limit))

    # Total count (unlimited) for KPI; list still paged by `limit`
    total_count = None
    if include_count:
        try:
            pe_count = None
            if party_type in ("Employee", "Shareholder") and party:
                try:
                    from erpnext.accounts.party import get_party_account
                    party_account = get_party_account(party_type, party, company)
                    if party_account:
                        accounts_list = [party_account] if isinstance(party_account, str) else (party_account or [])
                        if accounts_list:
                            placeholders = ",".join(["%s"] * len(accounts_list))
                            account_type = frappe.db.get_value("Party Type", party_type, "account_type") or ""
                            expected_payment_type = "Receive" if account_type == "Receivable" else "Pay"
                            field = "paid_from" if expected_payment_type == "Receive" else "paid_to"
                            r = frappe.db.sql(
                                """SELECT COUNT(*) FROM `tabPayment Entry`
                                   WHERE docstatus=1 AND unallocated_amount>0 AND company=%s AND party_type=%s AND party=%s
                                   AND payment_type=%s AND """
                                + field
                                + " IN ("
                                + placeholders
                                + ")",
                                [company, party_type, party, expected_payment_type, *accounts_list],
                            )
                            pe_count = int(r[0][0]) if r else 0
                except Exception:
                    pass
            if pe_count is None:
                count_filters = {
                    "company": company,
                    "docstatus": 1,
                    "unallocated_amount": (">", 0),
                }
                if party_type and party:
                    count_filters["party_type"] = party_type
                    count_filters["party"] = party
                else:
                    # Same as list: do not count Employee/Shareholder when party not selected
                    count_filters["party_type"] = ("not in", ["Employee", "Shareholder"])
                if from_date and to_date:
                    count_filters["posting_date"] = ("between", [from_date, to_date])
                elif from_date:
                    count_filters["posting_date"] = (">=", from_date)
                elif to_date:
                    count_filters["posting_date"] = ("<=", to_date)
                pe_count = int(frappe.db.count("Payment Entry", filters=count_filters) or 0)

            # Count JV rows using the same conditions as _get_all_jv_payments / _get_jv_payments
            jv_count = 0
            try:
                date_clauses = ""
                jv_params: list = [company]
                if party_type and party:
                    date_clauses += " AND jea.party_type = %s AND jea.party = %s"
                    jv_params += [party_type, party]
                if from_date and to_date:
                    date_clauses += " AND je.posting_date BETWEEN %s AND %s"
                    jv_params += [from_date, to_date]
                elif from_date:
                    date_clauses += " AND je.posting_date >= %s"
                    jv_params.append(from_date)
                elif to_date:
                    date_clauses += " AND je.posting_date <= %s"
                    jv_params.append(to_date)
                jv_r = frappe.db.sql(
                    f"""
                    SELECT COUNT(*)
                    FROM `tabJournal Entry` je
                    INNER JOIN `tabJournal Entry Account` jea ON jea.parent = je.name
                    INNER JOIN `tabAccount` acc ON jea.account = acc.name
                    WHERE je.docstatus = 1
                      AND je.company = %s
                      AND acc.account_type IN ('Receivable', 'Payable')
                      AND jea.party_type IS NOT NULL AND jea.party != ''
                      AND (
                        CASE WHEN acc.account_type = 'Receivable'
                             THEN jea.credit_in_account_currency - jea.debit_in_account_currency
                             ELSE jea.debit_in_account_currency - jea.credit_in_account_currency
                        END
                      ) > 0
                      AND (jea.reference_type = '' OR jea.reference_type IS NULL
                           OR jea.reference_type IN ('Sales Order', 'Purchase Order'))
                      {date_clauses}
                    """,
                    jv_params,
                )
                jv_count = int(jv_r[0][0]) if jv_r else 0
            except Exception:
                jv_count = 0

            total_count = pe_count + jv_count
        except Exception:
            total_count = None

    rows = q.run(as_dict=True)
    out = []
    seen_jv = set()
    for r in rows:
        if r.payment_type == "Receive":
            receivable_payable_account = r.paid_from
            currency = r.paid_from_account_currency
        else:
            receivable_payable_account = r.paid_to
            currency = r.paid_to_account_currency

        out.append(
            _payment_row(
                id_=r.name,
                party_type=r.party_type,
                party=r.party,
                amount=r.unallocated_amount,
                date=r.posting_date,
                ref=r.reference_no,
                dir_="in" if r.payment_type == "Receive" else "out",
                company=r.company,
                note=(r.remarks or r.reference_no or ""),
                currency=currency or "",
                receivable_payable_account=receivable_payable_account,
                exchange_rate=r.source_exchange_rate if r.payment_type == "Receive" else r.target_exchange_rate,
                paid_from_account_currency=r.paid_from_account_currency,
            )
        )

    if party_type and party:
        # Party filter: add JV entries for this party (same as ERPNext Payment Reconciliation).
        accounts = list({p["receivable_payable_account"] for p in out if p.get("receivable_payable_account")})
        if not accounts:
            try:
                from erpnext.accounts.party import get_party_account
                acc = get_party_account(party_type, party, company, include_advance=True)
                if acc:
                    accounts = [acc]
            except Exception:
                pass
        for account in (accounts or []):
            # Fetch extra to account for de-dup & merge, then slice at end
            jv_list = _get_jv_payments(company, party_type, party, account, from_date, to_date, (limit or 50) + 20)
            for p in jv_list:
                key = (p["id"], p.get("reference_row"))
                if key not in seen_jv:
                    seen_jv.add(key)
                    out.append(p)
    else:
        # No party filter: include company-wide JV entries so list shows both PE and JV (like ERPNext).
        jv_list = _get_all_jv_payments(company, from_date, to_date, (limit or 50) + 20)
        for p in jv_list:
            key = (p["id"], p.get("reference_row"))
            if key not in seen_jv:
                seen_jv.add(key)
                out.append(p)

    out.sort(key=lambda x: (x.get("date") or getdate(nowdate())), reverse=True)
    if limit:
        out = out[: int(limit)]
    if include_count:
        has_more = bool(total_count is not None and (int(offset or 0) + int(limit or 0)) < int(total_count))
        return {"items": out, "count": total_count, "has_more": has_more}
    return out


@frappe.whitelist(methods=["GET"])
def get_invoices(
    company: str,
    party_type: str,
    party: str,
    receivable_payable_account: str,
    limit: int = 50,
    offset: int = 0,
    exclude_payment_name: str | None = None,
    include_xco: bool | int = True,
) -> list[dict]:
    """
    Return outstanding invoices (and JV outstandings) for the given party and account.
    Also fetches invoices from other companies for the same party (cross-company / xco)
    so the user can reconcile intercompany transactions.
    """
    if not all([company, party_type, party, receivable_payable_account]):
        frappe.throw(_("Company, Party Type, Party and Receivable/Payable Account are required"))

    from erpnext.accounts.party import get_party_account

    today = getdate(nowdate())
    fetch_n = (int(offset or 0) + int(limit or 0)) if limit else None
    invoices_all = get_outstanding_invoices(
        party_type,
        party,
        [receivable_payable_account],
        limit=fetch_n,
    )
    if exclude_payment_name:
        exclude = (exclude_payment_name or "").strip()
        if exclude:
            invoices_all = [
                inv
                for inv in invoices_all
                if not (inv.get("voucher_type") == "Payment Entry" and inv.get("voucher_no") == exclude)
            ]
    invoices = invoices_all[int(offset or 0) :] if offset else invoices_all

    out = []
    for inv in invoices:
        due = inv.get("due_date")
        overdue = bool(due and getdate(due) < today)
        out.append({
            "id": inv.get("voucher_no"),
            "party": party,
            "amount": float(inv.get("invoice_amount") or 0),
            "outstanding_amount": float(inv.get("outstanding_amount") or 0),
            "due": due,
            "overdue": overdue,
            "company": company,
            "invoice_type": inv.get("voucher_type"),
            "posting_date": inv.get("posting_date"),
            "currency": inv.get("currency") or "",
            "xco": False,
        })

    # Cross-company invoices: find outstanding invoices for the same party in other companies.
    if include_xco not in (False, 0, "0", "false"):
        other_companies = frappe.get_all(
            "Company",
            filters={"name": ("!=", company)},
            pluck="name",
        )
        seen_ids = {r["id"] for r in out}
        for other_co in other_companies:
            try:
                xco_account = get_party_account(party_type, party, other_co)
            except Exception:
                xco_account = None
            if not xco_account:
                continue
            try:
                xco_invs = get_outstanding_invoices(party_type, party, [xco_account])
            except Exception:
                continue
            for inv in xco_invs:
                inv_id = inv.get("voucher_no")
                if not inv_id or inv_id in seen_ids:
                    continue
                seen_ids.add(inv_id)
                due = inv.get("due_date")
                overdue = bool(due and getdate(due) < today)
                # Fetch the invoice's conversion_rate for FX preview in the modal.
                try:
                    inv_conversion_rate = frappe.db.get_value(
                        inv.get("voucher_type") or "Sales Invoice",
                        inv_id,
                        "conversion_rate",
                    ) or 1.0
                except Exception:
                    inv_conversion_rate = 1.0
                out.append({
                    "id": inv_id,
                    "party": party,
                    "amount": float(inv.get("invoice_amount") or 0),
                    "outstanding_amount": float(inv.get("outstanding_amount") or 0),
                    "due": due,
                    "overdue": overdue,
                    "company": other_co,
                    "invoice_type": inv.get("voucher_type"),
                    "posting_date": inv.get("posting_date"),
                    "currency": inv.get("currency") or "",
                    "exchange_rate": float(inv_conversion_rate),
                    "xco": True,
                    "xco_receivable_payable_account": xco_account,
                })

    return out


@frappe.whitelist(methods=["GET"])
def get_exceptions(
    company: str,
    limit_per_type: int = 50,
    offset_payments: int = 0,
    offset_invoices: int = 0,
    search_payments: str | None = None,
    search_invoices: str | None = None,
) -> dict:
    """
    Return exception items for the Exceptions tab: unmatched payments and ageing
    open invoices. total_in_system is the full count (for badge); total_count is
    the number of items in this response. Supports offset for pagination.
    search_payments / search_invoices: optional search string (party or doc name, LIKE).
    """
    if not company:
        frappe.throw(_("Company is required"))
    today = getdate(nowdate())
    limit_per_type = max(1, min(100, int(limit_per_type or 50)))
    offset_payments = max(0, int(offset_payments or 0))
    offset_invoices = max(0, int(offset_invoices or 0))
    search_payments = (search_payments or "").strip() or None
    search_invoices = (search_invoices or "").strip() or None

    # Full count for badge / "X of Y" (same logic as get_dashboard_stats, with optional search)
    _cutoff = (today - timedelta(days=30)).strftime("%Y-%m-%d")
    pe_filters_base = {
        "company": company,
        "docstatus": 1,
        "unallocated_amount": (">", 0),
    }
    if search_payments:
        try:
            term = "%" + search_payments + "%"
            r = frappe.db.sql(
                """SELECT COUNT(*) FROM `tabPayment Entry`
                   WHERE company=%s AND docstatus=1 AND unallocated_amount>0
                   AND (party LIKE %s OR name LIKE %s)""",
                (company, term, term),
            )
            total_unmatched_pe = int(r[0][0]) if r else 0
        except Exception:
            total_unmatched_pe = 0
    else:
        total_unmatched_pe = frappe.db.count("Payment Entry", filters=pe_filters_base) or 0

    si_filters_base = {
        "company": company,
        "docstatus": 1,
        "outstanding_amount": ("!=", 0),
        "posting_date": ("<=", _cutoff),
    }
    if search_invoices:
        try:
            term = "%" + search_invoices + "%"
            r = frappe.db.sql(
                """SELECT COUNT(*) FROM `tabSales Invoice`
                   WHERE company=%s AND docstatus=1 AND outstanding_amount!=0 AND posting_date<=%s
                   AND (customer LIKE %s OR name LIKE %s)""",
                (company, _cutoff, term, term),
            )
            total_ageing_si = int(r[0][0]) if r else 0
        except Exception:
            total_ageing_si = 0
    else:
        total_ageing_si = frappe.db.count("Sales Invoice", filters=si_filters_base) or 0

    pi_filters_base = {
        "company": company,
        "docstatus": 1,
        "outstanding_amount": ("!=", 0),
        "posting_date": ("<=", _cutoff),
    }
    if search_invoices:
        try:
            term = "%" + search_invoices + "%"
            r = frappe.db.sql(
                """SELECT COUNT(*) FROM `tabPurchase Invoice`
                   WHERE company=%s AND docstatus=1 AND outstanding_amount!=0 AND posting_date<=%s
                   AND (supplier LIKE %s OR name LIKE %s)""",
                (company, _cutoff, term, term),
            )
            total_ageing_pi = int(r[0][0]) if r else 0
        except Exception:
            total_ageing_pi = 0
    else:
        total_ageing_pi = frappe.db.count("Purchase Invoice", filters=pi_filters_base) or 0

    # Sum of outstanding for SI and PI (for header summary)
    total_si_amount = 0.0
    total_pi_amount = 0.0
    try:
        si_where = "company=%s AND docstatus=1 AND outstanding_amount!=0 AND posting_date<=%s"
        si_params = [company, _cutoff]
        if search_invoices:
            si_where += " AND (customer LIKE %s OR name LIKE %s)"
            si_params.extend(["%" + search_invoices + "%", "%" + search_invoices + "%"])
        r = frappe.db.sql(
            "SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabSales Invoice` WHERE " + si_where,
            si_params,
        )
        if r:
            total_si_amount = float(r[0][0] or 0)
    except Exception:
        pass
    try:
        pi_where = "company=%s AND docstatus=1 AND outstanding_amount!=0 AND posting_date<=%s"
        pi_params = [company, _cutoff]
        if search_invoices:
            pi_where += " AND (supplier LIKE %s OR name LIKE %s)"
            pi_params.extend(["%" + search_invoices + "%", "%" + search_invoices + "%"])
        r = frappe.db.sql(
            "SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabPurchase Invoice` WHERE " + pi_where,
            pi_params,
        )
        if r:
            total_pi_amount = float(r[0][0] or 0)
    except Exception:
        pass

    total_in_system = int(total_unmatched_pe) + int(total_ageing_si) + int(total_ageing_pi)
    total_ageing_invoices = int(total_ageing_si) + int(total_ageing_pi)

    # Unmatched payments: with offset, limit, and optional search
    pe = frappe.qb.DocType("Payment Entry")
    pe_query = (
        frappe.qb.from_(pe)
        .select(
            pe.name,
            pe.party_type,
            pe.party,
            pe.unallocated_amount,
            pe.posting_date,
            pe.payment_type,
            pe.paid_from,
            pe.paid_to,
            pe.paid_from_account_currency,
            pe.paid_to_account_currency,
        )
        .where(pe.docstatus == 1)
        .where(pe.company == company)
        .where(pe.unallocated_amount > 0)
    )
    if search_payments:
        search_term = "%" + search_payments + "%"
        pe_query = pe_query.where(
            (pe.party.like(search_term)) | (pe.name.like(search_term))
        )
    pe_rows = (
        pe_query.orderby(pe.posting_date, order=Order.asc)
        .offset(offset_payments)
        .limit(limit_per_type)
    ).run(as_dict=True)

    unmatched_payments = []
    for r in pe_rows:
        post_date = getdate(r.posting_date) if r.posting_date else today
        age_days = (today - post_date).days
        if r.payment_type == "Receive":
            currency = r.paid_from_account_currency
        else:
            currency = r.paid_to_account_currency
        unmatched_payments.append({
            "doctype": "Payment Entry",
            "name": r.name,
            "party_type": r.party_type or "",
            "party": r.party or "",
            "amount": float(r.unallocated_amount or 0),
            "date": str(r.posting_date) if r.posting_date else "",
            "age_days": age_days,
            "currency": currency or "",
            "payment_type": r.payment_type or "",
        })

    # Ageing open invoices: SI/PI with outstanding > 0 and posting_date older than 30 days
    cutoff = today - timedelta(days=30)
    cutoff_str = cutoff.strftime("%Y-%m-%d")

    si_filters = {
        "company": company,
        "docstatus": 1,
        "outstanding_amount": ("!=", 0),
        "posting_date": ("<=", cutoff_str),
    }
    # Fetch enough to apply offset after merge+sort (cap fetch to avoid huge queries)
    fetch_limit = offset_invoices + limit_per_type
    fetch_limit = min(fetch_limit, 500)
    si_or = [["customer", "like", "%" + search_invoices + "%"], ["name", "like", "%" + search_invoices + "%"]] if search_invoices else None
    if search_invoices:
        si_list = frappe.get_all(
            "Sales Invoice",
            filters=si_filters,
            or_filters=si_or,
            fields=["name", "customer", "posting_date", "outstanding_amount", "currency", "is_return", "debit_to"],
            order_by="posting_date asc",
            limit=fetch_limit,
        )
    else:
        si_list = frappe.get_all(
            "Sales Invoice",
            filters=si_filters,
            fields=["name", "customer", "posting_date", "outstanding_amount", "currency", "is_return", "debit_to"],
            order_by="posting_date asc",
            limit=fetch_limit,
        )
    pi_filters = {
        "company": company,
        "docstatus": 1,
        "outstanding_amount": ("!=", 0),
        "posting_date": ("<=", cutoff_str),
    }
    pi_or = [["supplier", "like", "%" + search_invoices + "%"], ["name", "like", "%" + search_invoices + "%"]] if search_invoices else None
    if search_invoices:
        pi_list = frappe.get_all(
            "Purchase Invoice",
            filters=pi_filters,
            or_filters=pi_or,
            fields=["name", "supplier", "posting_date", "outstanding_amount", "currency", "is_return", "credit_to"],
            order_by="posting_date asc",
            limit=fetch_limit,
        )
    else:
        pi_list = frappe.get_all(
            "Purchase Invoice",
            filters=pi_filters,
            fields=["name", "supplier", "posting_date", "outstanding_amount", "currency", "is_return", "credit_to"],
            order_by="posting_date asc",
            limit=fetch_limit,
        )

    ageing_invoices = []
    for inv in si_list:
        post_date = getdate(inv.posting_date) if inv.posting_date else today
        age_days = (today - post_date).days
        ageing_invoices.append({
            "doctype": "Sales Invoice",
            "name": inv.name,
            "party_type": "Customer",
            "party": inv.customer or "",
            "amount": float(inv.outstanding_amount or 0),
            "date": str(inv.posting_date) if inv.posting_date else "",
            "age_days": age_days,
            "currency": inv.currency or "",
            "is_return": 1 if inv.get("is_return") else 0,
            "receivable_payable_account": inv.debit_to or "",
        })
    for inv in pi_list:
        post_date = getdate(inv.posting_date) if inv.posting_date else today
        age_days = (today - post_date).days
        ageing_invoices.append({
            "doctype": "Purchase Invoice",
            "name": inv.name,
            "party_type": "Supplier",
            "party": inv.supplier or "",
            "amount": float(inv.outstanding_amount or 0),
            "date": str(inv.posting_date) if inv.posting_date else "",
            "age_days": age_days,
            "currency": inv.currency or "",
            "is_return": 1 if inv.get("is_return") else 0,
            "receivable_payable_account": inv.credit_to or "",
        })
    # Sort by age descending (oldest first), apply offset and limit
    ageing_invoices.sort(key=lambda x: -x["age_days"])
    ageing_invoices = ageing_invoices[offset_invoices : offset_invoices + limit_per_type]

    total_count = len(unmatched_payments) + len(ageing_invoices)
    return {
        "unmatched_payments": unmatched_payments,
        "ageing_invoices": ageing_invoices,
        "total_count": total_count,
        "total_in_system": total_in_system,
        "total_unmatched_payments": int(total_unmatched_pe),
        "total_ageing_invoices": total_ageing_invoices,
        "total_ageing_si": int(total_ageing_si),
        "total_ageing_pi": int(total_ageing_pi),
        "total_si_amount": total_si_amount,
        "total_pi_amount": total_pi_amount,
        "offset_payments": offset_payments,
        "offset_invoices": offset_invoices,
    }


@frappe.whitelist(methods=["POST"])
def reconcile(
    company: str,
    party_type: str,
    party: str,
    receivable_payable_account: str,
    allocations: str,
    **kwargs,
) -> dict:
    """
    Perform payment reconciliation for the given party.
    allocations: JSON list of { "payment_name", "invoice_type", "invoice_number", "allocated_amount" }.
    """
    import json

    if not all([company, party_type, party, receivable_payable_account]):
        frappe.throw(_("Company, Party Type, Party and Receivable/Payable Account are required"))

    try:
        allocation_list = json.loads(allocations)
    except Exception as e:
        frappe.throw(_("Invalid allocations: {0}").format(str(e)))

    preview_only = kwargs.get("preview_only") in (1, "1", True, "true")

    if not allocation_list:
        frappe.throw(_("At least one allocation is required"))

    pr = frappe.get_doc(
        {
            "doctype": "Payment Reconciliation",
            "company": company,
            "party_type": party_type,
            "party": party,
            "receivable_payable_account": receivable_payable_account,
        }
    )
    pr.get_unreconciled_entries()

    if not pr.payments or not pr.invoices:
        frappe.throw(_("No unreconciled payments or invoices found for this party"))

    # Populate exchange rates so get_difference_amount() can compute FX gain/loss (same as ERPNext).
    invoice_exchange_map = pr.get_invoice_exchange_map(pr.invoices, pr.payments)
    for inv in pr.invoices:
        inv.exchange_rate = invoice_exchange_map.get(inv.invoice_number)
    for pay in pr.payments:
        if getattr(pay, "reference_type", None) in ("Sales Invoice", "Purchase Invoice"):
            pay.exchange_rate = invoice_exchange_map.get(getattr(pay, "reference_name", None))
        elif getattr(pay, "reference_type", None) == "Journal Entry":
            pay.exchange_rate = invoice_exchange_map.get(getattr(pay, "reference_name", None))

    exc_gain_loss_posting_date = frappe.db.get_single_value(
        "Accounts Settings", "exchange_gain_loss_posting_date", cache=True
    )

    # Build allocation table from user selection (supports multiple payments and JV with reference_row).
    pr.set("allocation", [])
    allocation_details = []
    for alloc in allocation_list:
        payment_name = alloc.get("payment_name")
        reference_row = alloc.get("reference_row")
        invoice_type = alloc.get("invoice_type")
        invoice_number = alloc.get("invoice_number")
        allocated_amount = float(alloc.get("allocated_amount") or 0)
        if not payment_name or not invoice_number or allocated_amount <= 0:
            continue

        def _match_pay(p):
            if p.reference_name != payment_name:
                return False
            if reference_row and getattr(p, "reference_row", None) != reference_row:
                return False
            return True

        pay_row = next((p for p in pr.payments if _match_pay(p)), None)
        inv_row = next((i for i in pr.invoices if i.invoice_number == invoice_number), None)
        if not pay_row or not inv_row:
            continue

        pay_dict = pay_row.as_dict() if hasattr(pay_row, "as_dict") else dict(pay_row)
        inv_dict = inv_row.as_dict() if hasattr(inv_row, "as_dict") else dict(inv_row)
        pay_dict["unreconciled_amount"] = pay_dict.get("amount")
        entry = pr.get_allocated_entry(pay_dict, inv_dict, allocated_amount)
        entry.difference_amount = pr.get_difference_amount(pay_dict, inv_dict, allocated_amount)
        entry.difference_account = frappe.get_cached_value(
            "Company", company, "exchange_gain_loss_account"
        )
        entry.exchange_rate = inv_dict.get("exchange_rate")
        entry.gain_loss_posting_date = pay_dict.get("posting_date") or nowdate()
        if exc_gain_loss_posting_date == "Invoice":
            entry.gain_loss_posting_date = inv_dict.get("invoice_date") or entry.gain_loss_posting_date
        elif exc_gain_loss_posting_date == "Reconciliation Date":
            entry.gain_loss_posting_date = nowdate()
        pr.append("allocation", entry)
        voucher_type = getattr(pay_row, "reference_type", None) or "Payment Entry"
        allocation_details.append({
            "payment_name": payment_name,
            "reference_row": reference_row,
            "voucher_type": voucher_type,
            "invoice_type": invoice_type or "Sales Invoice",
            "invoice_number": invoice_number,
            "allocated_amount": allocated_amount,
            "difference_amount": flt(entry.difference_amount),
        })

    if not pr.allocation:
        # All allocations are XCO (invoice belongs to another company).
        # Compute FX diff directly from payment and invoice exchange rates,
        # since get_unreconciled_entries() can't see the foreign-company invoice.
        if preview_only:
            xco_details = []
            total_xco_fx = 0.0
            pay_doc_cache = {}
            for alloc in allocation_list:
                if not alloc.get("xco"):
                    continue
                inv_type = alloc.get("invoice_type") or "Sales Invoice"
                inv_num = alloc.get("invoice_number")
                alloc_amt = float(alloc.get("allocated_amount") or 0)
                pname = alloc.get("payment_name")
                if not inv_num or alloc_amt <= 0 or not pname:
                    continue
                if pname not in pay_doc_cache:
                    pay_doc_cache[pname] = frappe.get_doc("Payment Entry", pname)
                pay_d = pay_doc_cache[pname]
                if pay_d.payment_type == "Receive":
                    p_rate = flt(pay_d.source_exchange_rate) or 1.0
                else:
                    p_rate = flt(pay_d.target_exchange_rate) or 1.0
                p_cur = pay_d.paid_from_account_currency
                p_base_cur = frappe.get_cached_value("Company", company, "default_currency")
                inv_d = frappe.get_doc(inv_type, inv_num)
                i_rate = flt(inv_d.conversion_rate) or 1.0
                if p_cur != p_base_cur:
                    pay_base = alloc_amt * p_rate
                    inv_base = alloc_amt * i_rate
                else:
                    pay_base = alloc_amt
                    inv_base = alloc_amt
                diff = flt(pay_base - inv_base)
                total_xco_fx += diff
                xco_details.append({
                    "payment_name": pname,
                    "invoice_type": inv_type,
                    "invoice_number": inv_num,
                    "allocated_amount": alloc_amt,
                    "difference_amount": diff,
                    "xco": True,
                })
            return {
                "success": True,
                "message": _("Preview"),
                "allocation_details": xco_details,
                "total_fx_gain_loss": total_xco_fx,
            }
        frappe.throw(_("No valid allocation rows"))

    total_fx = sum(d["difference_amount"] for d in allocation_details)

    if preview_only:
        # For any XCO allocations mixed in alongside same-company ones,
        # compute their FX contribution and add it to the total.
        pay_doc_cache = {}
        for alloc in allocation_list:
            if not alloc.get("xco"):
                continue
            inv_type = alloc.get("invoice_type") or "Sales Invoice"
            inv_num = alloc.get("invoice_number")
            alloc_amt = float(alloc.get("allocated_amount") or 0)
            pname = alloc.get("payment_name")
            if not inv_num or alloc_amt <= 0 or not pname:
                continue
            if pname not in pay_doc_cache:
                pay_doc_cache[pname] = frappe.get_doc("Payment Entry", pname)
            pay_d = pay_doc_cache[pname]
            p_rate = flt(pay_d.source_exchange_rate if pay_d.payment_type == "Receive" else pay_d.target_exchange_rate) or 1.0
            p_cur = pay_d.paid_from_account_currency
            p_base_cur = frappe.get_cached_value("Company", company, "default_currency")
            inv_d = frappe.get_doc(inv_type, inv_num)
            i_rate = flt(inv_d.conversion_rate) or 1.0
            if p_cur != p_base_cur:
                diff = flt(alloc_amt * p_rate - alloc_amt * i_rate)
            else:
                diff = 0.0
            total_fx += diff
            allocation_details.append({
                "payment_name": pname,
                "invoice_type": inv_type,
                "invoice_number": inv_num,
                "allocated_amount": alloc_amt,
                "difference_amount": diff,
                "xco": True,
            })

        return {
            "success": True,
            "message": _("Preview"),
            "allocation_details": allocation_details,
            "total_fx_gain_loss": total_fx,
        }

    # Snapshot JEA rows for each JV BEFORE reconcile.
    # ERPNext's update_reference_in_journal_entry() REMOVES the original JEA row and
    # creates a NEW one with the invoice reference — so the old reference_row names are
    # gone after reconcile. We need to capture the new row names so undo works correctly.
    jv_jea_before: dict[str, set] = {}
    for d in allocation_details:
        if d.get("voucher_type") == "Journal Entry":
            jv = d["payment_name"]
            if jv not in jv_jea_before:
                jv_jea_before[jv] = set(
                    frappe.db.get_all("Journal Entry Account", filters={"parent": jv}, pluck="name")
                )

    pr.reconcile()

    # After reconcile: for each JV allocation find the NEW JEA rows created and store them.
    for d in allocation_details:
        if d.get("voucher_type") != "Journal Entry":
            continue
        jv = d["payment_name"]
        old_names = jv_jea_before.get(jv, set())
        # New rows = rows that exist now but didn't before, referencing this specific invoice
        new_rows = frappe.db.get_all(
            "Journal Entry Account",
            filters={
                "parent": jv,
                "reference_type": d["invoice_type"],
                "reference_name": d["invoice_number"],
                "name": ("not in", list(old_names) if old_names else ["__none__"]),
            },
            fields=["name"],
            order_by="creation asc",
            limit=1,
        )
        if new_rows:
            d["reference_row"] = new_rows[0]["name"]
            # Mark this row as "used" so the next allocation for same invoice gets the next new row
            old_names.add(new_rows[0]["name"])
            jv_jea_before[jv] = old_names

    # Log for history and undo
    total_allocated = sum(d["allocated_amount"] for d in allocation_details)
    inv_currency = None
    for inv in pr.invoices:
        if inv.invoice_number == (allocation_details[0].get("invoice_number") if allocation_details else None):
            inv_currency = getattr(inv, "currency", None) or frappe.get_cached_value(
                "Company", company, "default_currency"
            )
            break
    if not inv_currency and pr.invoices:
        inv_currency = getattr(pr.invoices[0], "currency", None) or frappe.get_cached_value(
            "Company", company, "default_currency"
        )
    log = frappe.get_doc({
        "doctype": "Matcha Payment Reconciliation Log",
        "company": company,
        "party_type": party_type,
        "party": party,
        "receivable_payable_account": receivable_payable_account,
        "total_allocated": total_allocated,
        "currency": inv_currency or frappe.get_cached_value("Company", company, "default_currency"),
        "allocations_json": json.dumps(allocation_details),
        "status": "Reconciled",
    })
    log.insert(ignore_permissions=True)

    return {
        "success": True,
        "message": _("Successfully Reconciled"),
        "allocation_details": allocation_details,
        "total_fx_gain_loss": total_fx,
        "log_name": log.name,
    }


@frappe.whitelist(methods=["GET"])
def get_payment_reconciliation_history(
    company: str,
    from_date: str | None = None,
    to_date: str | None = None,
    party_type: str | None = None,
    party: str | None = None,
    search: str | None = None,
    hide_undone: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Return payment reconciliation log entries for history tab."""
    if not company:
        frappe.throw(_("Company is required"))
    filters = [["company", "=", company]]
    if from_date:
        filters.append(["creation", ">=", from_date])
    if to_date:
        # Include full day
        to_datetime = to_date if len(to_date) > 10 else (to_date + " 23:59:59")
        filters.append(["creation", "<=", to_datetime])
    if party_type:
        filters.append(["party_type", "=", party_type])
    if search and search.strip():
        filters.append(["party", "like", "%" + search.strip() + "%"])
    elif party:
        filters.append(["party", "=", party])
    if hide_undone and str(hide_undone).lower() in ("1", "true", "yes"):
        filters.append(["status", "=", "Reconciled"])
    logs = frappe.get_all(
        "Matcha Payment Reconciliation Log",
        filters=filters,
        fields=["name", "company", "party_type", "party", "total_allocated", "currency", "status", "owner", "creation", "allocations_json"],
        order_by="creation desc",
        limit=int(limit) or 50,
        start=int(offset) or 0,
    )
    for log in logs:
        log["allocations_json"] = log.get("allocations_json")  # keep for detail; optional to parse
    total = frappe.db.count("Matcha Payment Reconciliation Log", filters=filters)
    return {"items": logs, "total": total}


def _undo_jv_reconciliation_by_rows(company: str, jv_name: str, details: list[dict]) -> None:
    """
    Unlink only the specific JEA rows (stored as reference_row in the log after the reconcile fix).
    ERPNext's update_reference_in_journal_entry() REMOVES the original row and creates a NEW one
    with the invoice reference, so reference_row in the log is the NEW row's name.
    We clear that specific JEA row, then use ERPNext's standard PLE cleanup per invoice.
    """
    from frappe.query_builder import DocType
    from frappe.utils import now
    from erpnext.accounts.utils import (
        cancel_exchange_gain_loss_journal,
        update_accounting_ledgers_after_reference_removal,
        update_voucher_outstanding,
    )

    qb = frappe.qb

    reference_rows = [d.get("reference_row") for d in details if d.get("reference_row")]
    if not reference_rows:
        # Fallback: no row names stored (old logs) — use full unreconcile per invoice
        _undo_jv_full_for_invoices(company, jv_name, details)
        return

    # Fetch the current JEA rows (these are the NEW rows created during reconcile)
    jea_rows = frappe.db.get_all(
        "Journal Entry Account",
        filters={"parent": jv_name, "name": ("in", reference_rows)},
        fields=["name", "account", "party_type", "party", "reference_type", "reference_name"],
    )
    if not jea_rows:
        # New rows not found — possibly already cleared; update outstanding anyway
        _update_outstanding_for_details(details)
        return

    # 1. Clear reference_type/name only on these specific JEA rows
    jea = DocType("Journal Entry Account")
    (
        qb.update(jea)
        .set(jea.reference_type, None)
        .set(jea.reference_name, None)
        .set(jea.advance_voucher_type, None)
        .set(jea.advance_voucher_no, None)
        .set(jea.modified, now())
        .set(jea.modified_by, frappe.session.user)
        .where(jea.parent == jv_name)
        .where(jea.name.isin(reference_rows))
    ).run()

    # 2. For each (invoice → JV) pair, reset the PLE entries for these specific rows.
    #    PLE voucher_detail_no = JEA row name (set when ledger was reposted after reconcile).
    ple = DocType("Payment Ledger Entry")
    (
        qb.update(ple)
        .set(ple.against_voucher_type, ple.voucher_type)
        .set(ple.against_voucher_no, ple.voucher_no)
        .set(ple.modified, now())
        .set(ple.modified_by, frappe.session.user)
        .where(ple.voucher_type == "Journal Entry")
        .where(ple.voucher_no == jv_name)
        .where(ple.voucher_detail_no.isin(reference_rows))
        .where(ple.delinked == 0)
    ).run()

    # 3. Reset GL entries for these rows
    gle = DocType("GL Entry")
    (
        qb.update(gle)
        .set(gle.against_voucher_type, None)
        .set(gle.against_voucher, None)
        .set(gle.modified, now())
        .set(gle.modified_by, frappe.session.user)
        .where(gle.voucher_type == "Journal Entry")
        .where(gle.voucher_no == jv_name)
        .where(gle.voucher_detail_no.isin(reference_rows))
    ).run()

    # 4. Merge same-signature unreferenced JEA rows that were created by prior splits.
    #    After unlinking, rows that were split during reconcile are left as multiple
    #    identical-looking rows — combine them back into one clean row.
    _merge_unreferenced_jea_rows(jv_name, reference_rows)

    # 5. For each invoice affected, cancel FX journal and recompute outstanding.
    #    Use the account/party captured before clearing.
    by_invoice: dict[tuple, dict] = {}
    for row in jea_rows:
        if not row.get("reference_type") or not row.get("reference_name"):
            continue
        key = (row["reference_type"], row["reference_name"])
        if key not in by_invoice:
            by_invoice[key] = row

    for (ref_type, ref_no), row in by_invoice.items():
        if ref_type not in ("Sales Invoice", "Purchase Invoice"):
            continue
        ref_doc = frappe.get_doc(ref_type, ref_no)
        cancel_exchange_gain_loss_journal(ref_doc, "Journal Entry", jv_name)
        update_voucher_outstanding(
            ref_type, ref_no, row.get("account"), row.get("party_type"), row.get("party")
        )


def _merge_unreferenced_jea_rows(jv_name: str, cleared_row_names: list[str]) -> None:
    """
    After unlinking JEA rows from invoices, merge all unreferenced JEA rows that share
    the same account/party/cost-center/direction into a single row per group.

    ERPNext splits a JEA row each time a partial allocation is made, leaving N separate
    rows after N undone reconciliations. This function re-combines them into one tidy row.
    Only merges groups that contain at least one of the just-cleared rows.
    """
    from collections import defaultdict

    from frappe.query_builder import DocType
    from frappe.utils import now

    qb = frappe.qb
    cleared_set = set(cleared_row_names)

    # All unreferenced JEA rows for this JV (NULL or empty reference_type/name)
    all_unref = frappe.db.sql(
        """
        SELECT name, account, party_type, party, cost_center, project,
               account_currency, exchange_rate, is_advance,
               debit_in_account_currency, debit, credit_in_account_currency, credit
        FROM `tabJournal Entry Account`
        WHERE parent = %s
          AND (reference_type IS NULL OR reference_type = '')
          AND (reference_name IS NULL OR reference_name = '')
        ORDER BY creation ASC
        """,
        jv_name,
        as_dict=True,
    )

    # Group by a merge-signature: same account/party/direction/FX/cost-center/project
    groups: dict[tuple, list] = defaultdict(list)
    for row in all_unref:
        is_debit = bool(row.get("debit") or 0)
        sig = (
            row.get("account") or "",
            row.get("party_type") or "",
            row.get("party") or "",
            row.get("cost_center") or "",
            row.get("project") or "",
            row.get("account_currency") or "",
            float(row.get("exchange_rate") or 1),
            row.get("is_advance") or "No",
            is_debit,
        )
        groups[sig].append(row)

    jea_t = DocType("Journal Entry Account")
    ple_t = DocType("Payment Ledger Entry")
    gle_t = DocType("GL Entry")

    for _sig, rows in groups.items():
        if len(rows) < 2:
            continue
        row_names = {r["name"] for r in rows}
        # Only merge groups where at least one row was just unlinked
        if not row_names.intersection(cleared_set):
            continue

        survivor = rows[0]
        to_delete = [r["name"] for r in rows[1:]]

        total_debit_acc = sum(r.get("debit_in_account_currency") or 0 for r in rows)
        total_debit = sum(r.get("debit") or 0 for r in rows)
        total_credit_acc = sum(r.get("credit_in_account_currency") or 0 for r in rows)
        total_credit = sum(r.get("credit") or 0 for r in rows)

        # Update survivor JEA with the combined amount
        (
            qb.update(jea_t)
            .set(jea_t.debit_in_account_currency, total_debit_acc)
            .set(jea_t.debit, total_debit)
            .set(jea_t.credit_in_account_currency, total_credit_acc)
            .set(jea_t.credit, total_credit)
            .set(jea_t.modified, now())
            .set(jea_t.modified_by, frappe.session.user)
            .where(jea_t.name == survivor["name"])
        ).run()

        # Re-point non-survivor PLEs to the survivor row, then collapse into one PLE
        (
            qb.update(ple_t)
            .set(ple_t.voucher_detail_no, survivor["name"])
            .set(ple_t.modified, now())
            .set(ple_t.modified_by, frappe.session.user)
            .where(ple_t.voucher_type == "Journal Entry")
            .where(ple_t.voucher_no == jv_name)
            .where(ple_t.voucher_detail_no.isin(to_delete))
            .where(ple_t.delinked == 0)
        ).run()

        survivor_ples = frappe.db.get_all(
            "Payment Ledger Entry",
            filters={
                "voucher_type": "Journal Entry",
                "voucher_no": jv_name,
                "voucher_detail_no": survivor["name"],
                "delinked": 0,
            },
            fields=["name", "amount"],
            order_by="creation asc",
        )
        if len(survivor_ples) > 1:
            total_ple_amount = sum(r.get("amount") or 0 for r in survivor_ples)
            ple_survivor_name = survivor_ples[0]["name"]
            ple_to_delete = [r["name"] for r in survivor_ples[1:]]
            (
                qb.update(ple_t)
                .set(ple_t.amount, total_ple_amount)
                .set(ple_t.modified, now())
                .set(ple_t.modified_by, frappe.session.user)
                .where(ple_t.name == ple_survivor_name)
            ).run()
            (
                qb.from_(ple_t)
                .delete()
                .where(ple_t.name.isin(ple_to_delete))
            ).run()

        # Re-point non-survivor GLE rows to the survivor JEA row name
        (
            qb.update(gle_t)
            .set(gle_t.voucher_detail_no, survivor["name"])
            .set(gle_t.modified, now())
            .set(gle_t.modified_by, frappe.session.user)
            .where(gle_t.voucher_type == "Journal Entry")
            .where(gle_t.voucher_no == jv_name)
            .where(gle_t.voucher_detail_no.isin(to_delete))
        ).run()

        # Delete non-survivor JEA rows
        (
            qb.from_(jea_t)
            .delete()
            .where(jea_t.name.isin(to_delete))
        ).run()


def _undo_jv_full_for_invoices(company: str, jv_name: str, details: list[dict]) -> None:
    """Fallback for old log entries without reference_row: full unreconcile per invoice."""
    from erpnext.accounts.utils import (
        cancel_exchange_gain_loss_journal,
        unlink_ref_doc_from_payment_entries,
        update_voucher_outstanding,
    )
    seen: set[tuple] = set()
    for d in details:
        ref_type = d.get("invoice_type") or "Sales Invoice"
        ref_no = d.get("invoice_number")
        if not ref_no or (ref_type, ref_no) in seen:
            continue
        seen.add((ref_type, ref_no))
        ref_doc = frappe.get_doc(ref_type, ref_no)
        unlink_ref_doc_from_payment_entries(ref_doc, jv_name)
        update_voucher_outstanding(ref_type, ref_no, None, None, None)


def _update_outstanding_for_details(details: list[dict]) -> None:
    """Recompute outstanding_amount for each invoice in the details list."""
    from erpnext.accounts.utils import update_voucher_outstanding
    seen: set[tuple] = set()
    for d in details:
        ref_type = d.get("invoice_type") or "Sales Invoice"
        ref_no = d.get("invoice_number")
        if not ref_no or (ref_type, ref_no) in seen:
            continue
        seen.add((ref_type, ref_no))
        update_voucher_outstanding(ref_type, ref_no, None, None, None)


@frappe.whitelist()
def undo_payment_reconciliation(log_name: str | int) -> dict:
    """Undo a payment reconciliation by unlinking allocations. Uses Unreconcile Payment for PE; for JV unlinks only the specific rows in this log."""
    import json
    from collections import defaultdict

    log = frappe.get_doc("Matcha Payment Reconciliation Log", log_name)
    if log.status == "Undone":
        frappe.throw(_("This reconciliation was already undone."))
    try:
        details = json.loads(log.allocations_json or "[]")
    except Exception:
        frappe.throw(_("Invalid allocations data in log."))
    if not details:
        frappe.throw(_("No allocations to undo."))

    # Split XCO rows (identified by jv_payment_company) from same-company rows.
    xco_details = [d for d in details if d.get("jv_payment_company")]
    same_co_details = [d for d in details if not d.get("jv_payment_company")]

    # ── Undo XCO reconciliations: cancel both intercompany JVs ───────────────
    # Cancelling the JVs is sufficient — ERPNext automatically reverses the
    # Payment Ledger Entry linkages when a submitted JV is cancelled, which
    # restores the Payment Entry's unallocated amount and the invoice's
    # outstanding amount without needing a separate Unreconcile step.
    for d in xco_details:
        # Cancel invoice-company JV first (it carries the invoice reference).
        jv_inv_name = d.get("jv_invoice_company")
        if jv_inv_name:
            try:
                jv_inv = frappe.get_doc("Journal Entry", jv_inv_name)
                if jv_inv.docstatus == 1:
                    jv_inv.flags.ignore_permissions = True
                    jv_inv.cancel()
            except Exception as e:
                frappe.log_error(f"XCO undo: could not cancel {jv_inv_name}: {e}")

        # Cancel payment-company JV (holds the AR debit that was reconciled vs payment).
        jv_pay_name = d.get("jv_payment_company")
        if jv_pay_name:
            try:
                jv_pay = frappe.get_doc("Journal Entry", jv_pay_name)
                if jv_pay.docstatus == 1:
                    jv_pay.flags.ignore_permissions = True
                    jv_pay.cancel()
            except Exception as e:
                frappe.log_error(f"XCO undo: could not cancel {jv_pay_name}: {e}")

    # ── Undo same-company reconciliations ────────────────────────────────────
    groups = defaultdict(list)
    for d in same_co_details:
        key = (d.get("voucher_type") or "Payment Entry", d.get("payment_name"))
        groups[key].append(d)

    for (voucher_type, voucher_no), allocs in groups.items():
        invoice_refs = {(a.get("invoice_type"), a.get("invoice_number")) for a in allocs if a.get("invoice_number")}
        if not invoice_refs:
            continue

        if voucher_type == "Journal Entry" and any(a.get("reference_row") for a in allocs):
            _undo_jv_reconciliation_by_rows(log.company, voucher_no, allocs)
            continue

        unrecon = frappe.get_doc({
            "doctype": "Unreconcile Payment",
            "company": log.company,
            "voucher_type": voucher_type,
            "voucher_no": voucher_no,
        })
        unrecon.add_references()
        unrecon.allocations = [a for a in unrecon.allocations if (a.reference_doctype, a.reference_name) in invoice_refs]
        if not unrecon.allocations:
            continue
        unrecon.submit()

    log.status = "Undone"
    log.flags.ignore_permissions = True
    log.save()
    return {"success": True, "message": _("Reconciliation undone")}


@frappe.whitelist(methods=["POST"])
def reconcile_xco(
    payment_company: str,
    party_type: str,
    party: str,
    payment_name: str,
    receivable_payable_account: str,
    allocations: str,
) -> dict:
    """
    Reconcile a payment in one company (payment_company) against invoices in other companies.

    For each xco allocation:
      1. Post a Journal Entry in the payment company:
           Dr  Party receivable account (payment_company)   ← clears unallocated amount
           Cr  Intercompany bridge account (payment_company)
         with a reference to the Payment Entry (allocates the payment)

      2. Post a linked Journal Entry in the invoice company:
           Dr  Intercompany bridge account (invoice_company)
           Cr  Party receivable account (invoice_company)    ← clears the invoice
         with a reference to the invoice, linked back to the JV in step 1

      3. Run ERPNext Payment Reconciliation in the payment company to reconcile
         the Payment Entry against the JV from step 1.

      4. Run ERPNext Payment Reconciliation in the invoice company to reconcile
         the invoice against the JV from step 2.

    Requires Matcha Settings → Intercompany Transfer Accounts to be configured for
    every company involved.
    """
    import json

    if not all([payment_company, party_type, party, payment_name, receivable_payable_account]):
        frappe.throw(_("All parameters are required"))

    try:
        alloc_list = json.loads(allocations)
    except Exception as e:
        frappe.throw(_("Invalid allocations JSON: {0}").format(str(e)))

    if not alloc_list:
        frappe.throw(_("No allocations provided"))

    # Load intercompany account map from Matcha Settings
    from matcha.matcha.doctype.matcha_settings.matcha_settings import MatchaSettings
    settings = MatchaSettings.get_settings()
    xco_account_map: dict[str, str] = {
        row.company: row.intercompany_account
        for row in (settings.intercompany_accounts or [])
        if row.company and row.intercompany_account
    }

    from erpnext.accounts.party import get_party_account
    from frappe.utils import nowdate, flt

    today = nowdate()
    results = []

    # ── Payment-level data (same for every allocation in this request) ────────
    pay_doc = frappe.get_doc("Payment Entry", payment_name)
    pay_foreign_currency = pay_doc.paid_from_account_currency  # e.g. "INR"
    pay_company_currency = frappe.get_cached_value("Company", payment_company, "default_currency")
    if pay_doc.payment_type == "Receive":
        pay_exchange_rate = flt(pay_doc.source_exchange_rate) or 1.0
    else:
        pay_exchange_rate = flt(pay_doc.target_exchange_rate) or 1.0
    pay_co_bridge = xco_account_map.get(payment_company)
    if not pay_co_bridge:
        frappe.throw(_(
            "No intercompany transfer account configured for {0}. "
            "Go to Matcha Settings → Intercompany Transfer Accounts and add one."
        ).format(payment_company))

    for alloc in alloc_list:
        invoice_company = alloc.get("invoice_company")
        invoice_type = alloc.get("invoice_type") or "Sales Invoice"
        invoice_number = alloc.get("invoice_number")
        allocated_amount = flt(alloc.get("allocated_amount") or 0)
        xco_receivable_account = alloc.get("xco_receivable_payable_account")

        if not invoice_number or allocated_amount <= 0 or not invoice_company:
            continue

        # Resolve bridge account for this invoice's company
        inv_co_bridge = xco_account_map.get(invoice_company)
        if not inv_co_bridge:
            frappe.throw(_(
                "No intercompany transfer account configured for {0}. "
                "Go to Matcha Settings → Intercompany Transfer Accounts and add one."
            ).format(invoice_company))

        inv_company_currency = frappe.get_cached_value("Company", invoice_company, "default_currency")

        # Resolve invoice company's party receivable/payable account
        if not xco_receivable_account:
            xco_receivable_account = get_party_account(party_type, party, invoice_company)
        if not xco_receivable_account:
            frappe.throw(_("Could not determine receivable/payable account for {0} in {1}").format(
                party, invoice_company
            ))

        # ── Compute exchange rates and FX gain/loss ───────────────────────────
        # Invoice exchange rate (base / foreign) in invoice company's context.
        # pay_doc, pay_exchange_rate, pay_foreign_currency are resolved above the loop.

        # Invoice exchange rate (base / foreign) in invoice company's context.
        inv_doc = frappe.get_doc(invoice_type, invoice_number)
        inv_exchange_rate = flt(inv_doc.conversion_rate) or 1.0

        # allocated_amount is in the invoice's foreign currency (e.g. INR).
        # Convert to base currency of each company.
        # If both companies share the same base currency (common for subsidiaries),
        # the FX diff is simply the rate difference x foreign amount.
        if pay_foreign_currency != pay_company_currency:
            # Multi-currency payment: amounts are in foreign currency
            pay_base_amount = flt(allocated_amount) * pay_exchange_rate
            inv_base_amount = flt(allocated_amount) * inv_exchange_rate
        else:
            # Payment already in base currency, no rate conversion needed
            pay_base_amount = flt(allocated_amount)
            inv_base_amount = flt(allocated_amount)

        # FX difference for history / UI only; accounting is handled by ERPNext's
        # own Exchange Gain/Loss JV when the Payment Entry is reconciled.
        fx_diff = flt(pay_base_amount - inv_base_amount)

        # ── JV in payment company ────────────────────────────────────────────
        # Dr Party Receivable  — at the INVOICE exchange rate (= inv_base_amount in base)
        #   so the intercompany transfer happens at the same FX rate as the invoice.
        # Cr Intercompany bridge — same base amount.
        jv_pay = frappe.new_doc("Journal Entry")
        jv_pay.voucher_type = "Inter Company Journal Entry"
        jv_pay.company = payment_company
        jv_pay.posting_date = today
        jv_pay.multi_currency = 1 if pay_foreign_currency != pay_company_currency else 0
        jv_pay.user_remark = _("Intercompany transfer: {0} → {1} for {2}").format(
            payment_company, invoice_company, party
        )
        # Debit AR — base amount equal to the invoice-side base amount.
        ar_row = {
            "account": receivable_payable_account,
            "party_type": party_type,
            "party": party,
            "debit": inv_base_amount,
            # Intentionally no reference so it appears as outstanding debit that
            # Payment Reconciliation can match against the Payment Entry credit.
        }
        if pay_foreign_currency != pay_company_currency:
            ar_row["account_currency"] = pay_foreign_currency
            # Use the INVOICE exchange rate here so the transfer uses the
            # same FX rate as the invoice; the Payment Entry keeps its own rate.
            ar_row["exchange_rate"] = inv_exchange_rate
            ar_row["debit_in_account_currency"] = flt(allocated_amount)
        else:
            ar_row["debit_in_account_currency"] = inv_base_amount
        jv_pay.append("accounts", ar_row)

        # Credit bridge — same base amount as the AR debit.
        bridge_row = {
            "account": pay_co_bridge,
            "credit": inv_base_amount,
            "credit_in_account_currency": inv_base_amount,
        }
        jv_pay.append("accounts", bridge_row)

        jv_pay.flags.ignore_permissions = True
        jv_pay.insert()
        jv_pay.submit()

        # ── JV in invoice company ────────────────────────────────────────────
        # Dr Intercompany bridge — at invoice exchange rate
        # Cr Party Receivable    — WITH reference so ERPNext's PLE clears the invoice.
        # Both rows are in the invoice company's base currency (= inv_base_amount).
        jv_inv = frappe.new_doc("Journal Entry")
        jv_inv.voucher_type = "Inter Company Journal Entry"
        jv_inv.company = invoice_company
        jv_inv.posting_date = today
        jv_inv.multi_currency = 1 if inv_doc.currency != inv_company_currency else 0
        jv_inv.inter_company_journal_entry_reference = jv_pay.name
        jv_inv.user_remark = _("Intercompany transfer: {0} → {1} for {2}").format(
            payment_company, invoice_company, party
        )
        jv_inv.append("accounts", {
            "account": inv_co_bridge,
            "debit": inv_base_amount,
            "debit_in_account_currency": inv_base_amount,
        })
        inv_ar_row = {
            "account": xco_receivable_account,
            "party_type": party_type,
            "party": party,
            "credit": inv_base_amount,
            "reference_type": invoice_type,
            "reference_name": invoice_number,
            "is_advance": "No",
        }
        if inv_doc.currency != inv_company_currency:
            inv_ar_row["account_currency"] = inv_doc.currency
            inv_ar_row["exchange_rate"] = inv_exchange_rate
            inv_ar_row["credit_in_account_currency"] = flt(allocated_amount)
        else:
            inv_ar_row["credit_in_account_currency"] = inv_base_amount
        jv_inv.append("accounts", inv_ar_row)
        jv_inv.flags.ignore_permissions = True
        jv_inv.insert()
        jv_inv.submit()

        # Link the two JVs back to each other
        frappe.db.set_value(
            "Journal Entry", jv_pay.name,
            "inter_company_journal_entry_reference", jv_inv.name
        )

        # ── Reconcile Payment Entry vs JV in payment company ─────────────────
        # The JV posted above has a plain AR debit (no reference), so it now
        # appears as an outstanding "invoice" row in Payment Reconciliation.
        # We must explicitly reconcile the Payment Entry (credit) against that JV
        # (debit) to clear the payment's outstanding amount.
        pr_pay = frappe.get_doc({
            "doctype": "Payment Reconciliation",
            "company": payment_company,
            "party_type": party_type,
            "party": party,
            "receivable_payable_account": receivable_payable_account,
        })
        pr_pay.get_unreconciled_entries()
        pr_pay.set("allocation", [])

        pay_row = next(
            (p for p in pr_pay.payments if p.reference_name == payment_name), None
        )
        jv_row = next(
            (i for i in pr_pay.invoices if i.invoice_number == jv_pay.name), None
        )

        if not pay_row:
            frappe.throw(
                _("Payment Entry {0} not found as unreconciled in {1}").format(
                    payment_name, payment_company
                )
            )
        if not jv_row:
            frappe.throw(
                _("Journal Entry {0} not found as outstanding in {1} — "
                  "please check that the intercompany bridge account is correct").format(
                    jv_pay.name, payment_company
                )
            )

        pay_dict = pay_row.as_dict()
        inv_dict = jv_row.as_dict()
        # JV rows from get_unreconciled_entries() have exchange_rate 0; set the
        # invoice rate we used so ERPNext's reconcile() computes FX correctly
        inv_dict["exchange_rate"] = inv_exchange_rate
        pay_dict["unreconciled_amount"] = pay_dict.get("amount")
        entry = pr_pay.get_allocated_entry(pay_dict, inv_dict, allocated_amount)
        # Set FX difference on the allocation row so the posted JV uses our computed amount
        entry["difference_amount"] = pr_pay.get_difference_amount(
            pay_dict, inv_dict, allocated_amount
        )
        entry["exchange_rate"] = inv_dict.get("exchange_rate")
        exc_gain_loss_posting_date = frappe.db.get_single_value(
            "Accounts Settings", "exchange_gain_loss_posting_date", cache=True
        )
        entry["gain_loss_posting_date"] = pay_dict.get("posting_date") or nowdate()
        if exc_gain_loss_posting_date == "Invoice":
            entry["gain_loss_posting_date"] = inv_dict.get("invoice_date") or entry["gain_loss_posting_date"]
        elif exc_gain_loss_posting_date == "Reconciliation Date":
            entry["gain_loss_posting_date"] = nowdate()
        entry["difference_account"] = frappe.get_cached_value(
            "Company", payment_company, "exchange_gain_loss_account"
        )
        pr_pay.append("allocation", entry)
        pr_pay.reconcile()

        results.append({
            "payment_name": payment_name,
            "invoice_type": invoice_type,
            "invoice_number": invoice_number,
            "invoice_company": invoice_company,
            "fx_gain_loss": fx_diff,
            "allocated_amount": allocated_amount,
            "jv_payment_company": jv_pay.name,
            "jv_invoice_company": jv_inv.name,
        })

    if not results:
        frappe.throw(_("No valid intercompany allocations were processed"))

    # ── Write history log (same doctype as regular reconcile) ────────────────
    total_allocated = sum(r["allocated_amount"] for r in results)
    total_fx = sum(r.get("fx_gain_loss", 0) for r in results)
    # For XCO we log the amounts in the payment's currency (same as what the
    # user sees/inputs in the UI), and show FX separately in company currency.
    payment_currency = pay_foreign_currency or frappe.get_cached_value(
        "Company", payment_company, "default_currency"
    )
    log = frappe.get_doc({
        "doctype": "Matcha Payment Reconciliation Log",
        "company": payment_company,
        "party_type": party_type,
        "party": party,
        "receivable_payable_account": receivable_payable_account,
        "total_allocated": total_allocated,
        "currency": payment_currency,
        "allocations_json": json.dumps(results),
        "status": "Reconciled",
    })
    log.insert(ignore_permissions=True)

    return {
        "success": True,
        "message": _("Intercompany reconciliation complete — JVs posted in both entities"),
        "results": results,
        "total_fx_gain_loss": total_fx,
        "log_name": log.name,
    }
