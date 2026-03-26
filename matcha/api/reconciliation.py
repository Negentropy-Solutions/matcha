import json
from collections.abc import Iterable

import frappe
from frappe import _


def _ensure_transaction(name: str):
	try:
		return frappe.get_doc("Bank Transaction", name)
	except frappe.DoesNotExistError:
		frappe.throw(_("Bank Transaction {0} not found").format(name))


def _log_reconciliation_action(
	*,
	bank_transaction,
	voucher_type: str | None,
	voucher: str | None,
	action: str,
	batch_id: str | None = None,
	rule: str | None = None,
	reconciled_amount: float | None = None,
	note: str | None = None,
):
	"""Create a Matcha Reconciliation Log entry for audit/history."""

	doc = frappe.get_doc(
		{
			"doctype": "Matcha Reconciliation Log",
			"bank_transaction": bank_transaction.name,
			"company": bank_transaction.company,
			"bank_account": bank_transaction.bank_account,
			"voucher_type": voucher_type,
			"voucher": voucher,
			"action": action,
			"batch_id": batch_id,
			"rule": rule,
			"reconciled_amount": reconciled_amount,
			"note": note,
		}
	)
	doc.insert(ignore_permissions=True)


@frappe.whitelist(methods=["POST"])
def reconcile_vouchers(bank_transaction: str, vouchers: str, is_new_voucher: int | bool = 0) -> dict:
	"""
	Attach one or more vouchers to a Bank Transaction and trigger allocation.

	`vouchers` is expected to be a JSON list of dicts with keys:
	- payment_doctype
	- payment_name
	- amount
	"""

	tx = _ensure_transaction(bank_transaction)

	if tx.unallocated_amount <= 0:
		frappe.throw(_("Bank Transaction {0} is already fully reconciled").format(tx.name))

	try:
		voucher_list: Iterable[dict] = json.loads(vouchers)
	except Exception as exc:
		frappe.throw(_("Invalid vouchers payload: {0}").format(exc))

	for item in voucher_list:
		tx.append(
			"payment_entries",
			{
				"payment_document": item.get("payment_doctype"),
				"payment_entry": item.get("payment_name"),
				"allocated_amount": 0.0,  # allocation happens in allocate_payment_entries
				"reconciliation_type": "Voucher Created" if frappe.utils.cint(is_new_voucher) else "Matched",
			},
		)

	tx.validate_duplicate_references()
	tx.allocate_payment_entries()
	tx.update_allocated_amount()
	tx.set_status()
	tx.save()

	for item in voucher_list:
		_log_reconciliation_action(
			bank_transaction=tx,
			voucher_type=item.get("payment_doctype"),
			voucher=item.get("payment_name"),
			action="Voucher Created" if frappe.utils.cint(is_new_voucher) else "Matched",
			reconciled_amount=item.get("amount"),
		)

	return tx.as_dict()


@frappe.whitelist(methods=["POST"])
def unreconcile_transaction(bank_transaction: str) -> dict:
	"""
	Completely unreconcile a Bank Transaction.

	If linked vouchers were created from Matcha, they are cancelled; if they
	pre-existed, they are simply unlinked.
	"""

	tx = _ensure_transaction(bank_transaction)

	created_vouchers: list[tuple[str, str]] = []

	for entry in list(tx.payment_entries):
		if entry.reconciliation_type == "Voucher Created":
			created_vouchers.append((entry.payment_document, entry.payment_entry))

	tx.remove_payment_entries()
	tx.save()

	for doctype, name in created_vouchers:
		doc = frappe.get_doc(doctype, name)
		if doc.docstatus == 1:
			doc.cancel()

		_log_reconciliation_action(
			bank_transaction=tx,
			voucher_type=doctype,
			voucher=name,
			action="Unreconciled",
		)

	return {"success": True}


@frappe.whitelist(methods=["POST"])
def undo_single_action(bank_transaction: str, voucher_type: str, voucher: str) -> dict:
	"""
	Undo a single reconciliation action on a Bank Transaction.

	This is used by the UI for fine-grained undo without touching the
	rest of the transaction's links.
	"""

	tx = _ensure_transaction(bank_transaction)

	for entry in list(tx.payment_entries):
		if entry.payment_document == voucher_type and entry.payment_entry == voucher:
			if entry.reconciliation_type == "Voucher Created":
				doc = frappe.get_doc(voucher_type, voucher)
				if doc.docstatus == 1:
					doc.cancel()
			tx.remove_payment_entry(entry)
			tx.save()

			_log_reconciliation_action(
				bank_transaction=tx,
				voucher_type=voucher_type,
				voucher=voucher,
				action="Unreconciled",
			)
			break

	return {"success": True}
