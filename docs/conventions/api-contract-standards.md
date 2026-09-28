# 前后端接口契约规范

[interface-contract.json](../../interface-contract.json) 是双方协调者维护的契约入口。本轮 P0 状态为 agreed_for_implementation，表示已确认实施依据，仍待真实环境联调和联合验收。历史初始 draft 空清单不能作为开发或验收合同。

## 事实与变更

按 endpoint 核对前端 src/api 与后端路由、Handler/DTO；记录两边 revision、request/response、HTTP status、错误体、认证、分页、SSE 和证据路径。双方确认同一版本后才能设置 agreed。任何变更先记录影响和双方书面确认，再由授权写入者更新；不能伪造签名。

当前 Axios 拦截器直接返回 res.data，前端并未统一要求 code/message/data/timestamp 包装。用户模板的 code=0、2xxx/3xxx/4xxx/5xxx、pageNum/pageSize/total/list 仅为候选设计，不是现行后端合同。不得擅自重包响应、改错误码或分页字段；每个接口单独记录实际结构。

## 传输与鉴权

生产 HTTPS，JSON 接口注明 Content-Type 和 UTF-8；文件、下载、multipart 和 text/event-stream 按各接口例外记录。鉴权迁移参考 [领域说明](../agents/domain.md)。记录 Access/Refresh、Cookie、Origin、credentials、401、撤销与注销规则；禁止用放宽 CORS/Cookie 绕过失败。

## SSE

当前平台聊天和对比是 fetch POST 流，不强制改 EventSource。约定事件名及 data schema、终止/错误、meta、GUID、顺序、取消和超时；id、ping、断线重连及补发均需后端证据与明确确认。非幂等请求不得自动重试产生重复计费。

## 全阶段检查清单

- [ ] 双方工作树、revision、契约版本和确认记录明确。
- [ ] 方法/路径/认证/request/response/错误状态与字段实际匹配。
- [ ] GUID、时间单位与枚举映射已依 [数据规范](database-standards.md) 核对。
- [ ] SSE 分块、多行、CRLF、终止、失败、401、取消/断开已覆盖或明确待实现。
- [ ] 旧登录接口退役与迁移边界明确，不将历史 Mock 登录视作真实通过。
- [ ] 独立环境正常、异常、边界和权限用例已执行，保存脱敏证据。
- [ ] 最终 Quality Gate 复核和双方签收完成；SKIPPED 不等于 PASS。
