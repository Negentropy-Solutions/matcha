function getCsrfToken() {
  // In production: Frappe's Jinja processing injects the real token into
  // window.frappe.csrf_token synchronously before any JS runs (see index.html).
  // In dev: main.jsx sets window.frappe.csrf_token from the get_boot_context API.
  if (window.frappe && window.frappe.csrf_token) {
    const t = window.frappe.csrf_token;
    if (!t.startsWith('{{')) return t;
  }
  // window.csrf_token fallback (same value, set at same time)
  if (window.csrf_token && !window.csrf_token.startsWith('{{')) return window.csrf_token;
  return '';
}

/**
 * Extract a human-readable message from a Frappe API error response.
 * Frappe's _server_messages is a JSON array where each element is itself
 * a JSON-encoded message object: '["{\"message\":\"...\"}"]'
 */
export function parseServerMessage(res, fallback) {
  try {
    if (res?._server_messages) {
      const arr = JSON.parse(res._server_messages);
      const last = arr[arr.length - 1];
      const obj = typeof last === 'string' ? JSON.parse(last) : last;
      if (obj?.message) return obj.message;
    }
  } catch (_) { /* ignore */ }
  return fallback || 'An error occurred';
}

export function apiCall(method, args, postBody) {
  const url =
    '/api/method/' +
    method +
    (args ? '?' + new URLSearchParams(args).toString() : '');

  const opts = {
    method: postBody ? 'POST' : 'GET',
    headers: { 'X-Frappe-CSRF-Token': getCsrfToken() },
  };

  if (postBody) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(postBody);
  }

  return fetch(url, opts).then((r) => r.json());
}
