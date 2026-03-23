frappe.ui.form.on('Matcha Settings', {
	onload(frm) {
		frm.set_query('intercompany_account', 'intercompany_accounts', (doc, cdt, cdn) => {
			const row = frappe.get_doc(cdt, cdn);
			return {
				filters: {
					company: row.company || '',
					is_group: 0,
				},
			};
		});
	},
});

frappe.ui.form.on('Matcha Intercompany Account', {
	company(frm, cdt, cdn) {
		// Clear stale account selection when company changes
		frappe.model.set_value(cdt, cdn, 'intercompany_account', '');
	},
});
