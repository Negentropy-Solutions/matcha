import frappe


def get_context(context):
    """
    Serve the Matcha React SPA shell.

    Data is fetched by the frontend via get_boot_context (whitelisted API).
    This context function just sets meta properties for the page.
    """
    if not frappe.session.user or frappe.session.user == "Guest":
        frappe.throw("You need to be logged in to access Matcha.", frappe.PermissionError)

    context.no_cache = 1
    context.title = "Matcha – Payment Reconciliation"
    context.show_sidebar = False


@frappe.whitelist()
def get_boot_context():
    """
    Return initial boot data required by the Matcha React app.
    Called once at startup by main.jsx.
    """
    if not frappe.session.user or frappe.session.user == "Guest":
        frappe.throw("Authentication required", frappe.PermissionError)

    default_company = (
        frappe.defaults.get_user_default("company")
        or frappe.defaults.get_global_default("company")
        or ""
    )

    companies = frappe.get_all(
        "Company",
        fields=["name", "abbr"],
        order_by="name",
        ignore_permissions=False,
    )

    currencies = frappe.get_all(
        "Currency",
        fields=["name", "symbol", "symbol_on_right"],
        filters={"enabled": 1},
        ignore_permissions=False,
    )

    return {
        "default_company": default_company,
        "companies": companies,
        "currency_symbols": {c["name"]: (c.get("symbol") or c["name"]) for c in currencies},
        "currency_symbol_on_right": {c["name"]: c.get("symbol_on_right") for c in currencies},
        "csrf_token": frappe.local.session.data.csrf_token,
    }