import frappe
from frappe.model.document import Document


class MatchaSettings(Document):
	"""
	Container for global Matcha configuration.

	This doctype is intentionally small and focused on feature flags and
	sensible defaults so it can evolve without impacting core flows.
	"""

	@staticmethod
	def get_settings():
		"""Return the singleton Matcha Settings document."""
		return frappe.get_single("Matcha Settings")
