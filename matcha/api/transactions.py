import frappe
from frappe import _


@frappe.whitelist(methods=["GET"])
def list_bank_transactions(
	bank_account: str,
	from_date: str | None = None,
	to_date: str | None = None,
	include_fully_reconciled: bool = False,
	company: str | None = None,
) -> list[dict]:
	"""
	Return bank transactions for a given account and period.

	By default, only transactions with a positive unallocated amount are
	returned so the UI can focus on items that still need attention.
	"""

	if not bank_account:
		frappe.throw(_("Bank Account is required"))

	filters: list[list] = [["bank_account", "=", bank_account], ["docstatus", "=", 1]]

	if not include_fully_reconciled:
		filters.append(["unallocated_amount", ">", 0.0])

	if from_date:
		filters.append(["date", ">=", from_date])

	if to_date:
		filters.append(["date", "<=", to_date])

	if company:
		filters.append(["company", "=", company])

	fields = [
		"name",
		"date",
		"deposit",
		"withdrawal",
		"currency",
		"description",
		"transaction_type",
		"bank_account",
		"company",
		"allocated_amount",
		"unallocated_amount",
		"reference_number",
		"party_type",
		"party",
		"status",
		"matched_rule",
	]

	transactions = frappe.get_list("Bank Transaction", fields=fields, filters=filters, order_by="date")
	return transactions


@frappe.whitelist(methods=["GET"])
def count_older_unreconciled(bank_account: str, from_date: str) -> dict:
	"""
	Count older unreconciled transactions for a bank account.
	"""

	if not bank_account or not from_date:
		frappe.throw(_("Bank Account and From Date are required"))

	filters = {
		"bank_account": bank_account,
		"date": ["<", from_date],
		"docstatus": 1,
		"unallocated_amount": [">", 0.0],
	}

	count = frappe.db.count("Bank Transaction", filters=filters)

	if not count:
		return {"count": 0, "oldest_date": None}

	oldest = frappe.db.get_list(
		"Bank Transaction",
		filters=filters,
		fields=["date"],
		order_by="date",
		limit=1,
	)

	return {
		"count": count,
		"oldest_date": oldest[0].date if oldest else None,
	}


@frappe.whitelist(methods=["GET"])
def get_account_balance(bank_account: str, till_date: str, company: str) -> float | None:
	"""
	Return cleared balance as per ERP for the bank account till the given date.
	Mirrors ERPNext Bank Reconciliation Tool's "Closing Balance as per ERP".
	"""
	if not bank_account or not till_date or not company:
		return None
	try:
		fn = frappe.get_attr(
			"erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.get_account_balance"
		)
		return fn(bank_account=bank_account, till_date=till_date, company=company)
	except Exception:
		return None
