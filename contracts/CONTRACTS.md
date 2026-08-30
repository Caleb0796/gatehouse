# Gatehouse CONTRACTS v2.2

> Frozen interfaces between build lanes. Changes only via the coordinator (version bump + changelog).

## 3. CONTRACTS v2.2（冻结；改动只经协调者，版本递增广播）

### 3.1 TargetSpec —— `targets/<id>/manifest.json`（A3/A6/D2 增补）
```json
{
  "id": "marked-1234", "library": "marked", "kind": "real",
  "badVersion": "4.2.0", "goodVersion": "4.1.1",
  "badSha256": "<hex64>", "goodSha256": "<hex64>",
  "globalName": "marked",
  "issueUrl": "https://github.com/markedjs/marked/issues/NNNN",
  "licenseFile": "LICENSE.marked.txt",
  "summary": "≤200 chars",
  "demoRepros": { "broken": "<js>", "weak": "<js>", "real": "<js>" }
}
```
`demoRepros` = 模拟 agent 三轮脚本的素材（broken→FAIL_BOTH、weak→PASS_BOTH、real→绿），S1 随目标一起交付，S4 只消费不发明（A6）。`kind:"seed"` 时页面与 README 显著标注 demo target。

### 3.2 沙盒 postMessage 协议（B3/B9 加固版）
```
parent→iframe  { t:"load", bundles:[{sha256, text}] }            // 每目标一次，iframe 按 sha 缓存（B9）
parent→iframe  { t:"run",  runId, bundleSha, globalName, code, timeoutMs }
iframe→parent  { t:"ready" } / { t:"result", runId, verdict, logs, durationMs }
```
**parent 侧加固（B3）**：只受理 `e.source === iframe.contentWindow` 的消息；`ready` 之前一律丢弃；每 runId 只取第一条 result，后到丢弃；30s 看门狗失联即拆 iframe 重建判 timeout。**runner 侧**：worker 消息必须符合内部信封形状，否则按 error 收束；preamble 里 `self.postMessage = undefined` 遮蔽后经闭包引用回发（提高伪造成本；**不宣称杜绝**——残余风险按 §0.4 写进威胁模型）。bundle 由 parent fetch 并对 manifest sha256 校验，失败拒运行。logs 上限 100 条 × 500 字符。

### 3.3 Repro 语义
`assert(condition, message)` 注入；`pass`=跑完无抛出、`fail`=抛 ReproAssertionError、`error`=其它异常、`timeout`=超时被 terminate。**write_repro 入参上限 8KB**（B5，v1 的 50KB 作废）。

### 3.4 RunResult / DifferentialVerdict（A3/A4 修订）
`runDifferential(code, {targetId, timeoutMs?}) → Promise<DifferentialVerdict>`——**targetId 必填**，重放锚定同一 manifest 与 bundle 哈希（A3）。
每次调用固定交错执行 5 次 bad 和 5 次 good；返回 `repeats:5`、`stable:boolean`、`samples:{bad:RunResult[5],good:RunResult[5]}`，并保留 `runs` 作为每个版本最后一个样本的工具摘要。调用方不得把单个 `runs` 摘要当作稳定性证据。
**`judgePair` 是 16 组合全覆盖的全函数，按序判定**（A4）：
1. `bad:"fail" && good:"pass"` → `green:true, reason:"STABLE_LOCAL_DIFFERENTIAL"`
2. `bad:"timeout"` → `BAD_TIMEOUT`；3. `bad:"error"` → `BAD_ERROR`；4. `good:"timeout"` → `GOOD_TIMEOUT`；5. `good:"error"` → `GOOD_ERROR`
6. `bad:"pass" && good:"fail"` → `INVERTED`；7. 双 fail → `FAIL_BOTH`；8. 双 pass → `PASS_BOTH`
批量 `judge` 先把任一样本的 error/timeout 归为 `EXECUTION_ERROR`，再把同版本 verdict 混杂或 bad 失败指纹不一致归为 `UNSTABLE`；其余稳定批次委托给 `judgePair`。`tests/s1-differential.test.mjs` 必须枚举 `judgePair` 全部 16 组合，并覆盖批量稳定、非稳定与执行失败。

### 3.5 SubmissionArtifact（A3/F1 增补）
schema v2 包含目标、版本、bundle SHA-256、repro、repro SHA-256、`green`、`reason`、`stable`、`repeats`、完整 `samples`、timeline、签名时间、UA、`issueUrl:string|null` 与 `targetKind:"real"|"seed"`。artifact 不再存 v1 的单对 `runs`；`samples.bad` 与 `samples.good` 的长度必须都等于 `repeats`。每个 artifact sample 的字段为 `{verdict,logs,durationMs,bundleSha256}`，每样本 logs 最多 5 条、每条最多 200 字符，序列化 artifact 上限 32KB。无姓名字段不变。

### 3.6 Surface 事件（`src/shared/bus.js`，S2 发、S3/S4 听）
```js
bus.emit("surface", { change:"registered"|"revoked", tool:"submit_report", reason:"differential green"|"differential not green"|"repro edited", at:Date.now() });
bus.emit("run",     { verdict: DifferentialVerdict });      // S4 时间线/计分牌
bus.emit("draft",   { reproSha256, length, invalid? });     // S4 草稿状态；超 8KB 时 invalid:true
bus.emit("staged",  { artifactDraft });                     // S2→签名 UI
bus.emit("signed",  { artifact: SubmissionArtifact });      // S3 收件箱入库
```

### 3.7 回执 URL / JSON（B5/B6 重写）
分享前先把 artifact 投影为公开副本，默认删除全部 sample logs，并显示**完整公开 JSON 预览、可能的凭据/私网地址提示、规范 receipt ID 与明确的第三方分享警告**。只有人工再次确认且预览 ID 仍匹配时才编码；这一步是防误分享提示，不是秘密扫描保证。

编码：canonical JSON → `CompressionStream("deflate-raw")` → base64url → `receipt.html#a=<payload>&h=<canonical-sha256>`。完整 URL 预算 ≤6KB；超限或浏览器不支持压缩时提供同一公开投影的下载 JSON，并由回执页的 **Import receipt JSON** 导入。无论 URL 或 JSON，解码前压缩数据上限 64KB，解压/导入后的 JSON 上限 32KB。

解码后执行**严格 schema v2 全字段校验**（手写，不用 assertShape），校验每侧正好 5 个样本、verdict 与 bundle SHA-256 一致、时间/日志边界、canonical 内容哈希及 `sha256(repro)`。回执页把四个状态分开显示：repro source hash 仅为 self-consistent；build origin、independent run、approver identity 均为 `not verified`。版本/哈希字段原样展示并注明 as-claimed。**渲染只用 `textContent`，不使用 `innerHTML`**；解码失败返回 `{error}` 并给出可操作提示，不向页面抛出未处理异常。

### 3.8 冻结层代码（S0 落盘，全员只读）

`src/shared/hash.js`
```js
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
```
`src/shared/bus.js`
```js
const target = new EventTarget();
export const bus = {
  emit: (type, detail) => target.dispatchEvent(new CustomEvent(type, { detail })),
  on:   (type, fn) => { const h = e => fn(e.detail); target.addEventListener(type, h); return () => target.removeEventListener(type, h); },
};
```
`src/shared/schema.js`：`assertShape(obj, spec)` 极简结构校验（键存在 + typeof）。**仅用于 postMessage 信封形状；工具入参与回执解码必须手写严格校验，不得依赖它**（A5）。S0 连同 `tests/shared.test.mjs` 落盘。

### 3.9 fixtures（S0 落盘）
`contracts/fixtures/`：`differential-green.json`、`differential-failboth.json`、`differential-inverted.json`、`artifact.sample.json`——从 §3.4/§3.5 实例化、字段齐全，供 S2/S3/S4/S5 集成前 mock。

### 3.10 工具实现表（新增，A6）
`src/surface/surface.js` 导出 `getToolTable() → { [name]: { definition, execute } }`——modelContext 注册、S4 模拟 agent 无 WebMCP 时直调、S5 `?test=1` hook 三方共用同一张表。**hook 只在 `?test=1` 挂 `window.__gatehouseTestHook = { getTools, executeTool }`**，且 evals 结果里凡经 hook 跑的案例标 `tier:"logic"`（见 §5-S5）。

### 3.11 index.html 槽位契约（新增，A7）
```html
<header id="env-banner"></header>
<main>
  <section id="target-panel"></section>  <section id="editor-panel"></section>
  <section id="run-panel"></section>     <aside id="timeline"></aside>
  <section id="sign-panel"></section>    <section id="inbox-root" hidden></section>
</main>
<footer id="scoreboard"></footer>
```
每模块导出 `init(rootEl, deps)`；S0 落骨架，S2 拥有装配顺序与样式基线；其它线只认自己的槽位 id，不改壳。

---


## Changelog
- v2 (2026-08-29): initial frozen set, post adversarial review.
- v2.1 (2026-08-29): F1 stability gate — differential runs N=5 per version; green reason renamed to STABLE_LOCAL_DIFFERENTIAL; added UNSTABLE / EXECUTION_ERROR; artifact schema v→2 stores full samples. The gate is a non-determinism filter + local self-attestation, NOT an anti-forgery gate.
- v2.2 (2026-08-29): Receipt sharing now uses a reviewed public projection, canonical content hash, strict size/schema checks, and JSON fallback; surface events document non-green revocation and invalid oversized drafts.
