#!/bin/sh
set -eu

EXPECTED_CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

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

actual_cache_control=$(printf '%s\n' "$final_headers" | awk '
  {
    name = $0
    sub(/:.*/, "", name)
    if (tolower(name) == "cache-control") {
      value = $0
      sub(/^[^:]*:[ \t]*/, "", value)
      sub(/[ \t]*$/, "", value)
      print tolower(value)
    }
  }
')

if [ "$actual_cache_control" != "no-store" ]; then
  echo "Cache-Control mismatch" >&2
  echo "expected: no-store" >&2
  echo "actual:   ${actual_cache_control:-<missing>}" >&2
  exit 1
fi

actual_content_type_options=$(printf '%s\n' "$final_headers" | awk '
  {
    name = $0
    sub(/:.*/, "", name)
    if (tolower(name) == "x-content-type-options") {
      value = $0
      sub(/^[^:]*:[ \t]*/, "", value)
      sub(/[ \t]*$/, "", value)
      print tolower(value)
    }
  }
')

if [ "$actual_content_type_options" != "nosniff" ]; then
  echo "X-Content-Type-Options mismatch" >&2
  echo "expected: nosniff" >&2
  echo "actual:   ${actual_content_type_options:-<missing>}" >&2
  exit 1
fi

actual_frame_options=$(printf '%s\n' "$final_headers" | awk '
  {
    name = $0
    sub(/:.*/, "", name)
    if (tolower(name) == "x-frame-options") {
      value = $0
      sub(/^[^:]*:[ \t]*/, "", value)
      sub(/[ \t]*$/, "", value)
      print tolower(value)
    }
  }
')

if [ "$actual_frame_options" != "deny" ]; then
  echo "X-Frame-Options mismatch" >&2
  echo "expected: DENY" >&2
  echo "actual:   ${actual_frame_options:-<missing>}" >&2
  exit 1
fi

actual_referrer_policy=$(printf '%s\n' "$final_headers" | awk '
  {
    name = $0
    sub(/:.*/, "", name)
    if (tolower(name) == "referrer-policy") {
      value = $0
      sub(/^[^:]*:[ \t]*/, "", value)
      sub(/[ \t]*$/, "", value)
      print tolower(value)
    }
  }
')

if [ "$actual_referrer_policy" != "no-referrer" ]; then
  echo "Referrer-Policy mismatch" >&2
  echo "expected: no-referrer" >&2
  echo "actual:   ${actual_referrer_policy:-<missing>}" >&2
  exit 1
fi

actual_permissions_policy=$(printf '%s\n' "$final_headers" | awk '
  {
    name = $0
    sub(/:.*/, "", name)
    if (tolower(name) == "permissions-policy") {
      value = $0
      sub(/^[^:]*:[ \t]*/, "", value)
      sub(/[ \t]*$/, "", value)
      print tolower(value)
    }
  }
')

if [ "$actual_permissions_policy" != "camera=(), geolocation=(), microphone=()" ]; then
  echo "Permissions-Policy mismatch" >&2
  echo "expected: camera=(), geolocation=(), microphone=()" >&2
  echo "actual:   ${actual_permissions_policy:-<missing>}" >&2
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
