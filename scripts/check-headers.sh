#!/bin/sh
set -eu

EXPECTED_CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'"

if [ "$#" -ne 1 ]; then
  echo "usage: $0 URL" >&2
  exit 2
fi

headers=$(curl --fail --silent --show-error --location --head --max-redirs 5 "$1")
final_headers=$(printf '%s\n' "$headers" | awk '
  /^HTTP\// { block = "" }
  {
    sub(/\r$/, "")
    block = block $0 "\n"
  }
  END { printf "%s", block }
')

actual_csp=$(printf '%s\n' "$final_headers" | awk '
  {
    name = $0
    sub(/:.*/, "", name)
    if (tolower(name) == "content-security-policy") {
      value = $0
      sub(/^[^:]*:[ \t]*/, "", value)
      print value
    }
  }
')

if [ "$actual_csp" != "$EXPECTED_CSP" ]; then
  echo "Content-Security-Policy mismatch" >&2
  echo "expected: $EXPECTED_CSP" >&2
  echo "actual:   ${actual_csp:-<missing>}" >&2
  exit 1
fi

oac_opt_out=$(printf '%s\n' "$final_headers" | awk '
  {
    name = $0
    sub(/:.*/, "", name)
    if (tolower(name) == "origin-agent-cluster") {
      value = $0
      sub(/^[^:]*:[ \t]*/, "", value)
      sub(/[ \t]*$/, "", value)
      if (value == "?0") found = 1
    }
  }
  END { print found ? "yes" : "no" }
')

if [ "$oac_opt_out" = "yes" ]; then
  echo "Origin-Agent-Cluster opts out with ?0" >&2
  exit 1
fi

echo "response headers match the Gatehouse baseline"
