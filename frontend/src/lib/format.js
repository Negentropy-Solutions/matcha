export function roundCurrency(n) {
	const x = Number(n);
	return isNaN(x) ? 0 : Math.round(x * 100) / 100;
}

export function toCents(n) {
	const x = Number(n);
	if (isNaN(x)) return 0;
	return Math.round(x * 100);
}

export function fromCents(c) {
	const x = Number(c);
	if (isNaN(x)) return 0;
	return x / 100;
}

export function fmt(n, currency, currencySymbols, currencySymbolOnRight) {
	const num = Math.abs(roundCurrency(Number(n)));
	const numStr = (isFinite(num) ? num : 0).toLocaleString("en-IN", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const cur = typeof currency === "string" ? currency : "";
	const syms = currencySymbols || window.matcha_currency_symbols || {};
	const onRightMap = currencySymbolOnRight || window.matcha_currency_symbol_on_right || {};
	const sym = cur && syms[cur] ? syms[cur] : cur;
	const onRight = cur && onRightMap[cur];
	if (!sym) return (cur || "") + " " + numStr;
	return onRight ? numStr + " " + sym : sym + " " + numStr;
}

export function fmtDate(d) {
	if (!d) return "";
	const dt = typeof d === "string" ? new Date(d) : d;
	return isNaN(dt.getTime())
		? d
		: dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function escapeHtml(s) {
	if (s == null || s === "") return "";
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function invoiceOutstanding(inv) {
	if (!inv) return 0;
	const out = inv.outstanding_amount !== undefined ? inv.outstanding_amount : inv.amount;
	return roundCurrency(out || 0);
}

export function formatHistoryDate(creationStr) {
	if (!creationStr) return "";
	const s = String(creationStr).trim().replace(" ", "T");
	const d = new Date(s);
	if (isNaN(d.getTime())) return creationStr;
	const day = d.getDate();
	const suf = day >= 10 && day <= 20 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
	const datePart =
		day +
		suf +
		" " +
		d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }).replace(/ /g, " ");
	const timePart = d
		.toLocaleTimeString("en-GB", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: true,
		})
		.toLowerCase()
		.replace(/\s/g, " ");
	return datePart + ", " + timePart;
}

export function appUrl(doctype, docname) {
	if (!docname) return "#";
	const slug = (doctype || "").toLowerCase().replace(/\s+/g, "-");
	return "/app/" + slug + "/" + encodeURIComponent(docname);
}
