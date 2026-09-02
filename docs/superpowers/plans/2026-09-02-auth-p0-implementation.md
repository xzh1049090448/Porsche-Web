# P0 用户名认证实施计划

用户已批准 M1 设计与 M2 前端代码/测试/跟踪文档修改。后端目标为 https://aiportcloud.com，90abbdc49513039fa9218a6ce72d3147fbf1721e（用户确认；公开health仅证实可达）。不部署，不对线上账号执行写操作，不改依赖/构建配置/后端。

## 基线与复用

原前端 main=9e133518874e1c0554615ae988f57d6d6cecfbf6。发现干净的 session-auth-frontend=6f8fbca 已实现用户名UI和五个原生请求入口，故在 feature/auth-p0-harden 隔离工作树复用其两个已有提交，再完成加固。不得覆盖原主工作树或其他分支。保留旧个人资料、实名/用量等既有功能，不能因复用分支删除功能。

## 任务

- [ ] 建立基线：按既有锁文件安装，运行 npm test、npm run build；记录 init.sh 的离线缓存限制。
- [ ] 测试先行：认证内存状态及共享协调，无凭据持久化；epoch/generation、5 GET单次刷新、迟到401、换用户、pending失败关闭、注销竞态。
- [ ] 实现认证核心（src/api/auth-session.js 及独立coordination模块）：无Pinia/router依赖，注入HTTP/浏览器适配；Web Locks串行Cookie变更，持久非敏感epoch/pending/suppressed，每次锁内复核；不可用时认证阻断。未知结果不自动恢复，不能声称Abort证明服务器取消。
- [ ] 请求整合（request.js/auth.js/users.js、原生fetch）：单独无重试auth HTTP；仅明确安全GET allowlist可恢复一次，epoch变更零重试；POST/SSE不重放；保留HTTP/body语义，nested/detail/Blob错误安全解析，403不注销。
- [ ] UI/store：用户名注册不自动登录；身份与profile独立；路由单次恢复；改密/会话撤销/注销；业务profile失败不撤销已认证身份；本地退出与服务端撤销结果区分。
- [ ] 身份隔离：旧token/user键清理，主题语言保留；所有业务响应、异步缓存、下载、SSE回调校验epoch；五旁路保持JSON/text/Blob/stream返回类型。
- [ ] SSE最小安全修复：error不可逆；[DONE]后等待业务done；缺done为incomplete；取消/错误不成功/不推算用量；原生取消接入，无POST重试。完整P1新功能不在此轮。
- [ ] 回归、实际本地浏览器mock验证（只本地拦截，不请求线上业务）、需求一致性审查、独立安全质量审查、修复再验证。
- [ ] 更新feature_list/progress/domain/契约与验证报告。自动化通过不等于M3联合验收；真实HTTPS Cookie/多标签故障/权限仍需隔离数据与明确授权。

## 评审通过的行为

认证状态 initializing/anonymous/authenticated/refreshing/signingOut/uncertain。共享身份epoch变化使旧响应失效；同epoch token generation变化允许安全GET用最新Token最多重试一次。pending在Cookie操作发出前落盘，只有匹配operationId和epoch的确定响应处理后才清理；不在finally无条件清除。logout失败保留非凭据退出标志，reload零自动refresh。能力缺失直接阻断，不做localStorage锁。认证响应未知时停止自动Cookie操作，提供明确恢复提示，不能保证任意崩溃线性一致性。

401按端点和响应分类：登录/注册/改密业务401不刷新重放；保护GET中间件401才有限恢复；refresh无效停止；403/503独立提示。Access/AuthUser成功即建立身份，profile失败独立恢复。SSE error为终态，后续done不能成功，缺最终业务done不算成功。

## 验证用例

AUTH001-035：注册规则、单次恢复、5并发GET、迟到响应、身份切换、多标签串行与通知丢失、缺能力/存储失败、pending崩溃标记、logout失败reload抑制、401/403分流、五旁路、profile503独立、无泄密错误。
SSE001-008：UTF8/CRLF多行分帧、[DONE]后done/error、EOF不完整、取消、重复终态、零POST重放。
ENV001-003：同源HTTPS Cookie/Origin、多标签真实故障（M3未执行，不伪造）。
