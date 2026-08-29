// Envelope-shape check ONLY (postMessage frames, bus payloads).
// Tool inputs and receipt decoding require handwritten strict validation —
// the browser does not validate inputSchema, and this helper checks neither
// arrays, enums, nesting, lengths, nulls, nor extra keys. Do not lean on it.
export function assertShape(obj, spec) {
  if (typeof obj !== "object" || obj === null) throw new Error("assertShape: not an object");
  for (const [k, t] of Object.entries(spec)) {
    if (typeof obj[k] !== t) throw new Error("assertShape: field " + k + " expected " + t + ", got " + typeof obj[k]);
  }
  return obj;
}
