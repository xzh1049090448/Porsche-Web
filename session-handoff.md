最新接续：线上仍3eeca2b；真实到期v2及限定并发/权限子项已双方书面接受。新本地菜单修复158a00e完成113测试/build/鼠标fixture及独立审查，发布包已准备但尚未部署。A/B遗留fixture与会话已清理；不要重复建账号。待新候选发布确认及有效SSE最多3次×32输出tokens授权，完整M3仍未签收。以下旧“到期运行中”仅历史阶段。

# 当前接续状态（2026-09-03，M3子项证据更新）

工作树为 `feature/auth-p0-harden`。M2本地验证与独立审查完成（113/113测试、build、浏览器flow），前端候选3eeca2b已获授权发布到aiportcloud.com，两个专用账号已创建并用于部分真实认证验收。不要重复创建账号或部署；不得读取私有账号凭据文件到报告。web-009仍in_progress，M3整体未通过。

最新完成：empty_username_and_password / username_length_1 / password_length_1三个非法注册样本400；真实/admin/users403转发profile的客户端故障注入保持身份、零refresh并重试恢复；丢Broadcast通知与延迟真实profile的跨身份防护；补跑refresh/logout跨标签串行与关闭refresh标签后pending/reload零自动认证。SSE无效Bearer真实中间件401断言通过，1POST/0refresh、calls/tokens0→0，仅证明拒绝零重放。首次tabs结果第一项PASS、随后FAIL（fresh context按钮disabled，初始响应未记录，根因未定），必须保留原始失败记录，不把补跑扩展成全项PASS。

后端project_manager基于第一轮证据已书面接受02注册/03/06/07/08正常注销/10会话隔离已测子项符合0bab2b7合同；没有独立运行或签整体M3。后端另已书面接受新增3个注册400样本、真实admin403/转发profile、跨标签串行/关闭以及无效Bearer的SSE 1POST/0refresh限定子项；仅为证据复核，未独立运行或签整体M3。运行镜像源码对应证明仍缺。

下一步：等待协调者送达真实Access到期并发结果，再按实际子项更新并交质量复核。本记录不授权付费模型调用，目录可见/有额度不是调用许可。详见 `docs/agents/p0-m3-readiness.md`、`docs/agents/validation/m3-*-results.json`、`progress.md`。本次仅文档更新，未提交；待最终证据和质量复核再收尾。

下面是上游Issue #3/#4的历史交接，其中未部署/未运行等描述只适用于当时范围。

---

# Session handoff — 2026-09-02 open issues

## Safe resume point

- Preserve both retained `fix/open-issue-resolution` worktrees:
  - Frontend: `/Users/xuzhihao/code/Porsche-Web/.worktrees/issue-resolution`.
  - Backend: `/Users/xuzhihao/code/Porsche/.worktrees/issue-resolution`.
- Do not work in the root checkouts by accident: concurrent user AGENTS/docs/config and other changes were left untouched. Do not reset, clean, merge or overwrite them.
- Read `AGENTS.md`, `progress.md`, `feature_list.json` and the [verification report](docs/superpowers/reports/2026-09-02-open-issues-verification.md), inspect `git status`/`git log`, then use `./init.sh`. No dependencies or lockfiles were changed this turn.

## Completed locally

- Frontend #3: `7471a38` + `fbfd2dd`, selected history loads initially, stale responses remain scoped, retry works, pending-history send waits correctly. `web-010` passing for this narrow local scope.
- Frontend #4: `969bdc5`, native-first copy with actual-dialog fallback, accurate success/failure, focus/selection restore, no Storage/logging, close/unmount cleanup and suppression of late fallback/toast. `web-011` passing for this narrow local scope.
- Independent PM/spec and quality/security approved both frontend fixes and final code range. Final frontend suite 81/81; build and diff checks passed. Independent initial/reload, six history adversarial scenarios, four real clipboard paths and six lifecycle/selection probes passed with local fake APIs only.
- Backend #2: `a4202de` records existing-fix evidence only. Targeted 13 top-level tests pass with no skips; vet passes. Business code was not changed.

## Not complete — do not overclaim

- Full backend tests with disposable real MySQL/Redis FAIL: migration test `assertColumn` returns empty metadata despite direct SQL evidence; service-test username fixtures exceed the existing 20-character schema limit. See the report and backend `progress.md`. A separate baseline-fix scope is needed; do not broaden production schema as a workaround.
- True upstream catalog/detail/Chat/SSE and HTTPS session-cookie acceptance are unperformed. `go-004` and broad frontend `web-009` remain blocked. `web-004` is not globally accepted by this narrow chat fix.
- No push, merge, deployment, production mutation, real API-key creation, or GitHub issue closure was authorized/performed. Issues remain open. User decides integration and real-environment acceptance.
- Native clipboard requests already submitted cannot be revoked; cleanup suppresses late UI/fallback, not the browser's already-started write.

## Resources

- The two new loopback-only disposable MySQL/Redis `--rm`/tmpfs fixtures were stopped; their ephemeral data is destroyed, with no user volume touched. They must be recreated explicitly for a later integration run.
- Coordinator-owned Vite development service on port 5178 was stopped after verification. Do not stop unrelated services.
- The report's `/private/tmp/playwright-test-issue3-*.js` and `/private/tmp/playwright-test-issue4-*.js` paths are historical execution evidence; coordinator owns cleanup of those four temporary probes and two fixture screenshots. Durable automated regressions remain in the repository Node tests. Browser probes used visible Chrome, the supplied runtime `NODE_PATH`, and intercepted all local APIs. A future `/api-keys` probe should navigate with the already-mounted app router to avoid the existing Vite `/api` proxy match.

This handoff and the completed-plan checklist are committed separately from the code/evidence commit; use `git log -3` for the final documentation SHA.
