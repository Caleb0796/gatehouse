export function createRunnerSrcdoc() {
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-gatehouse-runner\' \'wasm-unsafe-eval\'; worker-src blob:; connect-src \'none\'"><script nonce="gatehouse-runner" src="/src/sandbox/runner-inner.js"></script>';
}
