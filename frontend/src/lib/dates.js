export const DATE_PRESETS = [
	{ value: "this_week", label: "This week" },
	{ value: "last_week", label: "Last week" },
	{ value: "this_month", label: "This month" },
	{ value: "last_month", label: "Last month" },
	{ value: "this_quarter", label: "This quarter" },
	{ value: "last_quarter", label: "Last quarter" },
	{ value: "q1", label: "Q1" },
	{ value: "q2", label: "Q2" },
	{ value: "q3", label: "Q3" },
	{ value: "q4", label: "Q4" },
	{ value: "this_year", label: "This year" },
	{ value: "last_year", label: "Last year" },
	{ value: "this_fiscal_year", label: "This fiscal year" },
	{ value: "last_fiscal_year", label: "Last fiscal year" },
	{ value: "all", label: "All" },
];

export function toYMD(d) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return y + "-" + m + "-" + day;
}

export function getDatesForFilter(value, customFromDate, customToDate) {
	if (value === "custom" && customFromDate && customToDate) {
		return { from_date: customFromDate, to_date: customToDate };
	}
	const today = new Date();
	if (!value || value === "all") return { from_date: "", to_date: "" };
	const y = today.getFullYear();
	let from, to;
	if (value === "this_week") {
		const d = today.getDay();
		const sun = d === 0 ? 0 : -d;
		from = new Date(today);
		from.setDate(today.getDate() + sun);
		to = new Date(from);
		to.setDate(from.getDate() + 6);
	} else if (value === "last_week") {
		const d = today.getDay();
		const sun = d === 0 ? -7 : -d - 7;
		from = new Date(today);
		from.setDate(today.getDate() + sun);
		to = new Date(from);
		to.setDate(from.getDate() + 6);
	} else if (value === "this_month") {
		from = new Date(y, today.getMonth(), 1);
		to = new Date(y, today.getMonth() + 1, 0);
	} else if (value === "last_month") {
		from = new Date(y, today.getMonth() - 1, 1);
		to = new Date(y, today.getMonth(), 0);
	} else if (value === "this_quarter") {
		const q = Math.floor(today.getMonth() / 3) + 1;
		from = new Date(y, (q - 1) * 3, 1);
		to = new Date(y, q * 3, 0);
	} else if (value === "last_quarter") {
		const q = Math.floor(today.getMonth() / 3) + 1;
		if (q === 1) {
			from = new Date(y - 1, 9, 1);
			to = new Date(y - 1, 11, 31);
		} else {
			from = new Date(y, (q - 2) * 3, 1);
			to = new Date(y, (q - 1) * 3, 0);
		}
	} else if (value === "q1") {
		from = new Date(y, 0, 1);
		to = new Date(y, 2, 31);
	} else if (value === "q2") {
		from = new Date(y, 3, 1);
		to = new Date(y, 5, 30);
	} else if (value === "q3") {
		from = new Date(y, 6, 1);
		to = new Date(y, 8, 30);
	} else if (value === "q4") {
		from = new Date(y, 9, 1);
		to = new Date(y, 11, 31);
	} else if (value === "this_year" || value === "this_fiscal_year") {
		from = new Date(y, 0, 1);
		to = new Date(y, 11, 31);
	} else if (value === "last_year" || value === "last_fiscal_year") {
		from = new Date(y - 1, 0, 1);
		to = new Date(y - 1, 11, 31);
	} else {
		return { from_date: "", to_date: "" };
	}
	return { from_date: toYMD(from), to_date: toYMD(to) };
}

export function getDateFilterLabel(value, customFromDate, customToDate) {
	if (value === "custom") {
		return customFromDate && customToDate
			? customFromDate + " – " + customToDate
			: "Custom range";
	}
	const p = DATE_PRESETS.find((x) => x.value === value);
	return p ? p.label : value;
}

export function formatRangeDate(ymd) {
	if (!ymd) return "";
	const parts = ymd.split("-");
	if (parts.length !== 3) return ymd;
	const dt = new Date(
		parseInt(parts[0], 10),
		parseInt(parts[1], 10) - 1,
		parseInt(parts[2], 10)
	);
	const d = dt.getDate();
	const suf = d >= 10 && d <= 20 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[d % 10] || "th";
	return (
		d +
		suf +
		" " +
		dt.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).replace(/ /g, " ")
	);
}

export function getDateRangeLabel(value, customFromDate, customToDate) {
	const d = getDatesForFilter(value, customFromDate, customToDate);
	if (!d.from_date && !d.to_date) return "All time";
	if (!d.from_date || !d.to_date) return d.from_date || d.to_date || "";
	return formatRangeDate(d.from_date) + " → " + formatRangeDate(d.to_date);
}
