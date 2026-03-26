<p align="center">
  <a href="https://github.com/Negentropy-Solutions/matcha">
    <img width="220" height="282" alt="logo" src="https://github.com/user-attachments/assets/e0c0a560-2ae3-418d-837c-68a838e01805" />
  </a>
  <hr />
  <p align="center">
    Faster payment reconciliation for ERPNext
    <br />
    <br />
    <a href="https://github.com/Negentropy-Solutions/matcha/issues">Issues</a>
    ·
    <a href="https://github.com/Negentropy-Solutions/matcha">Repository</a>
    ·
    <a href="https://negentropysolutions.com/">Negentropy Solutions</a>
  </p>
</p>

<p align="center">
  <img width="1444" height="736" alt="Matcha app screenshot" src="https://github.com/user-attachments/assets/6472d6e0-cdae-4e1c-90dc-a5f3b95bc11b" />
</p>


<p align="center">
  <a href="https://github.com/Negentropy-Solutions/matcha/blob/main/license.txt">
    <img alt="license" src="https://img.shields.io/badge/license-AGPLv3-blue">
  </a>
  <a href="https://github.com/Negentropy-Solutions/matcha/stargazers">
    <img src="https://img.shields.io/github/stars/Negentropy-Solutions/matcha" alt="GitHub Stars">
  </a>
  <a href="https://github.com/Negentropy-Solutions/matcha/pulse">
    <img src="https://img.shields.io/github/commit-activity/m/Negentropy-Solutions/matcha" alt="Commits per month">
  </a>
</p>

Matcha is an open-source app for reconciling **Payment Entries** against **open invoices** in [ERPNext](https://frappe.io/erpnext).

It is built on [Frappe Framework](https://frappeframework.com) with a React UI and is available at the `/matcha` route on your site.

<hr>

### Features

##### Reconcile workspace (company + date scoped)
- Select company and date range to load only relevant records.
- Use search, received/paid filters, and multi-select for faster processing.
- Work in a two-panel layout: payments on the left, matching invoices on the right.

  
<img width="1400" height="940" alt="ChatGPT Image Mar 24, 2026, 02_32_35 AM" src="https://github.com/user-attachments/assets/d316309c-eaf5-48d2-92bb-e4d10ad25dbf" />


##### Dashboard summary cards
- Track `Unmatched payments`, `Open invoices`, `Overdue invoices`, and `Unmatched value`.
- Prioritize urgent items quickly before starting reconciliation.
- Values are shown in company context for better decision-making.

<img width="307" height="238" alt="Screenshot 2026-03-24 at 2 34 27 AM" src="https://github.com/user-attachments/assets/0d237458-cf99-4735-8301-598c930ecf94" />


##### Allocation tray with amount controls
- Allocate one payment to one or many invoices.
- Select multiple payments and split allocations as needed.
- Adjust per-invoice allocation values before posting.

<img width="1400" height="290" alt="Screenshot 2026-03-24 at 2 36 03 AM" src="https://github.com/user-attachments/assets/b881dc6c-dc89-4d5f-bdac-96a9f224dbc4" />


##### FX gain/loss preview
- Preview estimated FX impact before final reconciliation.
- See gain/loss in company base currency.
- Confirm with full visibility when reconciling multi-currency transactions.

<img width="1400" height="1024" alt="ChatGPT Image Mar 24, 2026, 02_41_54 AM" src="https://github.com/user-attachments/assets/2300d4c8-aa24-4d50-8721-7d4a879cee6e" />


##### Cross-company (XCO) reconciliation
- Reconcile payments and invoices across different companies.
- Matcha prepares and posts intercompany Journal Entries using bridge accounts.
- Keep linked records traceable from history after posting.

<img width="1400" height="1024" alt="ChatGPT Image Mar 24, 2026, 02_45_36 AM" src="https://github.com/user-attachments/assets/79ccebae-280b-4f0e-88d6-aec477b882dd" />


##### Exceptions tab
- View unmatched payments and ageing invoices in one place.
- Use independent search and pagination for each list.
- Jump directly into reconciliation from an exception item.

<img width="1400" height="1024" alt="ChatGPT Image Mar 24, 2026, 02_49_51 AM" src="https://github.com/user-attachments/assets/7bba0a90-a3d5-488a-ac37-8a97dc2e2ab5" />

##### History + undo
- Every action is recorded in `Matcha Payment Reconciliation Log`.
- Filter history by date and party to audit changes quickly.
- Undo reconciliations when corrections are required.

<img width="1400" height="1024" alt="ChatGPT Image Mar 24, 2026, 02_52_49 AM" src="https://github.com/user-attachments/assets/38b7be4d-e784-48ce-89ec-a7a4d81f64c9" />


##### Configuration via Matcha Settings
- Configure `Intercompany Transfer Accounts` in `Matcha Settings`.
- Add one bridge account per company in `Matcha Intercompany Account`.
- Required for cross-company reconciliation flows.

<img width="1400" height="1024" alt="ChatGPT Image Mar 24, 2026, 02_55_35 AM" src="https://github.com/user-attachments/assets/d104ec8e-ae39-4f58-a0e7-8594a6b81eb4" />



### Installation

**Supported versions**

- **Frappe**: `>=15.0.0` and `<16.0.0` (v15 benches)
- **ERPNext**: `>=15.0.0` and `<16.0.0`
- **Python**: `>=3.10`

- **Frappe**: `>=15.0.0` and `<17.0.0` (supports v15 and v16)
- **ERPNext**: `>=15.0.0` and `<17.0.0`
- **Python**: `>=3.10` (Frappe v16 requires newer core dependencies as per the v16 migration guide)

These match `[tool.bench.frappe-dependencies]` in `pyproject.toml`.

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/Negentropy-Solutions/matcha.git
bench install-app matcha
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/matcha
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

AGPLv3
