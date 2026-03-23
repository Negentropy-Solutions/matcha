# Copyright (c) 2025, Negentropy Solutions and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class MatchaPaymentReconciliationLog(Document):
	"""Append-only log of payment reconciliation actions from Matcha. Supports undo."""

	pass
