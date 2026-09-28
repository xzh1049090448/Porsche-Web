# PRD-260903 本地前后端联合验收最终报告

日期：2026-09-04。前端候选 `25a66a4ad546a481941dfc6e0cc9bc75da2e631b`，后端候选 `aec1619ee710c80cd71dbe529660e2d12b3fda7b`。最终状态：**FINAL_ACCEPTANCE_FAIL_PENDING_FIX_AND_CLEANUP**。

## 最终结论

本地联合验收 **FAIL**：26项中6项 `PASS_LIMITED_SCOPE`、2项 `FAIL_LOCAL_DEV_ROUTE`、18项阻塞。通过项仅证明当前只读管理切片和基础视觉/响应式范围，不代表完整PRD、生产发布或部署验收通过。

| 状态 | 数量 | 项目 |
| --- | ---: | --- |
| PASS_LIMITED_SCOPE | 6 | A01、A02、A04、A13、V01、V02 |
| FAIL_LOCAL_DEV_ROUTE | 2 | P02、R01 |
| BLOCKED_NOT_IMPLEMENTED | 16 | A03、A05、A06、A07、A08、A09、A10、A11、A12、A14、P01、P03、P04、P05、P06、P07 |
| BLOCKED_PRODUCT | 1 | P08 |
| BLOCKED_ENV | 1 | R02 |

机器可读逐项结果见 `acceptance-matrix.json`。

## 失败根因与证据优先级

第二阶段报告保留并取代核心阶段对logout后直达路由的早期解释。核心阶段原始结果没有被改写：它在浏览器路由稳定前采样，曾将logout/direct-route记为通过。第二阶段在两个`127.0.0.1`上下文重复确认：logout返回204、上下文Cookie清空、显式refresh返回401，也没有私有API Key DOM；但浏览器硬刷新`/api-keys`时，本地Vite的`/api`前缀代理先截获文档请求并转给后端，最终404，Vue路由守卫没有机会执行。

因此P02/R01的最终状态是`FAIL_LOCAL_DEV_ROUTE`。该结果不表示后端logout撤销失败、会话恢复成功或私有内容泄露，也不证明生产HTTPS路由存在同样问题。

证据优先顺序：

1. `FINAL-ACCEPTANCE-REPORT.md`和`acceptance-matrix.json`给出PM最终签字状态。
2. `SECOND-PHASE-REPORT.md`给出最终logout/路由诊断，并仅在该解释上supersede核心阶段。
3. `CORE-PHASE-REPORT.md`及全部raw JSON、截图保持原始不变，继续作为执行证据。

## 限定通过范围

- A01：普通用户管理列表403，真实页面无管理数据行。
- A02：Root/Admin层级、隐藏目标及详情边界通过。
- A04：GUID、分页、role/status/deleted、排序、转义LIKE、非法页码和前端最新筛选结果保护通过。
- A13：Root用户列表/详情没有危险写控件。
- V01：真实填充数据的1440用户列表和Admin详情截图已保存；landing/pricing及原型像素对照未覆盖。
- V02：375/768/1440、键盘/焦点、基础语义、减少动态和对比度检查通过；未安装`axe-core`，不是axe审计。

A05–A08只有读取或拒绝子集获得证据，其整项写能力仍未实现，所以最终矩阵保持`BLOCKED_NOT_IMPLEMENTED`。

## 遗留与准入

- 修正本地前端文档路由和API代理边界后，必须重新运行P02/R01的登录、logout、refresh、菜单直达和硬刷新；不能直接继承本次PASS子断言为整体PASS。
- 16项未实现、P08产品内容批准、R02生产部署/回滚需要各自独立授权、实现和证据。
- 本轮没有修改业务代码、生产数据、生产环境或部署状态。联合fixture和前后端进程继续保留，等待精确cleanup指令。

## 证据哈希

| 文件 | SHA-256 |
| --- | --- |
| `CORE-PHASE-REPORT.md` | `6971e1975c3bffc0fc976ca7cfe56442713a6756c4af393523956ea7aed55929` |
| `SECOND-PHASE-REPORT.md` | `45726625012f46d046896eeda1f673f9e4e66226c1dbb62719c2f84e364724a7` |
| `core-phase-results.json` | `a62458c278eb4087259f11baef4acf6291cf211938cc814ad3f2e9572dbb8b0e` |
| `phase2-results.json` | `434d63a383da5c69fa0e70ac87464345958e95e155d819466ba79e599c2f3310` |
| `p02-three-contexts.json` | `7c890fb903f44dc0af1b67da70b2949435551b4f3017b04bdce614b586ef6d37` |

环境恢复后的归档前manifest为`d3d1de8b3609721baba3e1f04ca19ef5990aaad2666e63f9aab7786cb6101641`；它是本最终文档更新前的环境证据节点，最终联合manifest将在后端归档中另行记录。

## Cleanup结果

PM最终签字并确认ARCHIVE PASS后，联合环境已完成精确cleanup。仅向FE session 23561和BE session 37608发送终止信号；PID 22388/22213及15173/18080监听消失。MySQL与Redis完整ID、名称、task label、image、loopback端口、tmpfs、AutoRemove、计划内只读bind和无named volume全部预检匹配，同label库存恰好两个；随后仅停止两个完整ID并由AutoRemove删除。仅删除精确私密目录`/private/tmp/porsche-joint-acceptance-260904-td1FYO`，没有使用glob、prune或volume删除。

最终复查：两个完整ID、精确名称、task label均无残留；15173、18080、61998、62001均无连接或监听；私密目录不存在。cleanup `PASS`。该资源清理不改变联合验收`FAIL`结论，也不能把web-012标为passing。
