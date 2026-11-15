<h1 align="center">koishi-plugin-monetary-cdk</h1>

<p align="center">
	为 Koishi 提供基于 <code>monetary</code> 通用货币系统的现代化兑换码功能。
</p>

<p align="center">
	<a href="https://www.npmjs.com/package/koishi-plugin-monetary-cdk"><img src="https://img.shields.io/npm/v/koishi-plugin-monetary-cdk?style=for-the-badge&logo=npm" alt="npm" /></a>
	<a href="https://github.com/BYWled/koishi-plugin-monetary-cdk"><img src="https://img.shields.io/github/stars/BYWled/koishi-plugin-monetary-cdk?style=for-the-badge&logo=github" alt="GitHub Stars" /></a>
	<a href="https://github.com/BYWled/koishi-plugin-monetary-cdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License" /></a>
</p>

<p align="center">
	<a href="https://gitee.com/BYWled/koishi-plugin-monetary-cdk"><img src="https://img.shields.io/badge/Gitee-代码镜像-C71D23?style=for-the-badge&logo=gitee&logoColor=white" alt="Gitee Mirror" /></a>
	<a href="https://gitcode.com/BYWled/koishi-plugin-monetary-cdk"><img src="https://img.shields.io/badge/GitCode-代码镜像-2962FF?style=for-the-badge" alt="GitCode Mirror" /></a>
</p>

<p align="center">
	<a href="https://github.com/BYWled/koishi-plugin-monetary-cdk">GitHub</a> ·
	<a href="https://gitee.com/BYWled/koishi-plugin-monetary-cdk">Gitee</a> ·
	<a href="https://gitcode.com/BYWled/koishi-plugin-monetary-cdk">GitCode</a>
</p>

一个更现代化的兑换码（CDK）插件：管理员可通过指令动态创建兑换码活动，支持时效、份数、指定用户/频道、每人限兑次数，并保留完整兑换审计流水。兑换采用数据库事务保证原子性，杜绝并发超兑。除指令外，也支持在插件配置中定义静态兑换码（启动时自动同步）。

> 版本：**Alpha.1**

## ✨ 特性

- **🎫 指令动态建码**：`cdk.create` 一条指令创建活动，口令可指定或随机生成（默认 8 位，自动剔除易混淆字符），无需重启。
- **⏱️ 时效与份数**：每个兑换码支持生效/过期时间（相对时长 `30m/12h/7d/2w` 或绝对时间）与总份数限制，兑换时实时校验。
- **👥 精准投放**：可选指定允许兑换的用户（@提及）与限定频道，实现定向福利。
- **🔒 原子兑换**：兑换在数据库事务内完成批次重校验、流水写入与货币入账，多用户并发不超发。
- **🧾 完整审计**：每笔兑换记录用户、频道、时间与数额，`cdk.info` 可随时查明细。
- **⚙️ 双通道管理**：指令动态创建 + 插件配置静态定义（启动同步，运行时状态保留），管理指令支持启停/删除/明细查询。
- **🏦 银行无关直入**：奖励直接入账 monetary 现金，与 [koishi-plugin-monetary-bank](https://github.com/BYWled/koishi-plugin-monetary-bank) 等生态插件天然兼容。

## 📦 依赖

| 服务 | 必需 | 说明 |
| --- | --- | --- |
| `database` | ✅ | 存储兑换码批次与兑换流水 |
| `monetary` | ✅ | 货币发放 |

## 🎮 指令说明

### 用户指令

- **`cdk <口令>`**
  - 兑换指定口令的货币奖励。
  - 每码每人限兑次数默认 1 次（可按码配置）；口令默认区分大小写（可配置）。
  - 示例：`cdk VIP2026`。

### 管理指令（authority ≥ 3）

- **`cdk.create`**
  - 创建兑换码，进入确认流程后生成；`-y` 跳过确认。
  - 选项：
    - `-n <名称>` 活动名称
    - `-a <数额>` 每份数额
    - `-c <口令>` 指定口令（**不指定时自动随机生成**）
    - `-t <份数>` 总份数（默认 1）
    - `-e <时效>` 过期时间（`30m/12h/7d/2w` 或 `2026-12-31 23:59`，默认 7 天）
    - `-s <时间>` 生效时间（默认立即）
    - `-u <用户>` 允许兑换的用户（@提及，**须放在最后**）
    - `-p <频道>` 限定频道 ID（**须放在最后**）
    - `-m <次数>` 每人限兑次数（默认 1）
    - `--currency <单位>` 货币单位（默认 coin）
    - `--note <备注>` 备注
    - `-y` 跳过确认
  - 示例：`cdk.create -n 新春红包 -a 100 -t 10 -e 7d -y`
- **`cdk.list [-a]`** — 查看兑换码列表（含状态标签；`-a` 包含已结束）。
- **`cdk.info <口令>`** — 查看批次详情与最近兑换明细。
- **`cdk.toggle <口令>`** — 启用 / 停用兑换码。
- **`cdk.delete <口令> [-y]`** — 删除兑换码（兑换流水保留）。
- **`cdk.help`** — 查看指令帮助。

## ⚙️ 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `currency` | string | `coin` | 默认货币单位 |
| `defaultExpireDays` | number | `7` | 建码未指定时效时的默认天数（0 = 永不过期） |
| `defaultMaxPerUser` | number | `1` | 默认每码每人限兑次数 |
| `codeLength` | number | `8` | 随机口令长度 |
| `caseInsensitive` | boolean | `false` | 口令是否不区分大小写 |
| `verboseError` | boolean | `true` | 兑换失败是否提示细化原因（关闭可防口令探测） |
| `codes` | table[] | `[]` | **静态兑换码**：启动时同步进数据库；已存在的只更新定义字段，已兑份数等运行时状态保留。字段与指令选项一致 |

## 🗃️ 数据库表

- `cdk_batch`：兑换码批次（口令、名称、数额、份数、时效、白名单等）。
- `cdk_redemption`：兑换流水（用户、频道、数额、时间），即审计记录。

## 🔒 与旧版 yutang-monetary-cdk 的差异

| | 旧版 yutang-monetary-cdk | 本插件 |
| --- | --- | --- |
| 建码方式 | 配置文件写死，改码需重启 | 指令动态创建 + 配置静态定义 |
| 时效/份数 | 不支持 | 每码独立配置 |
| 指定人/频道 | 不支持 | 用户与频道两级白名单 |
| 并发安全 | 读改写覆盖（会丢更新） | 事务 + 计数校验 |
| 审计 | 无 | 完整兑换流水 |

> 从旧版迁移：直接停用旧插件并安装本插件即可，旧 `yt_cdk` 表不受影响。

## 📄 License

[MIT](https://github.com/BYWled/koishi-plugin-monetary-cdk/blob/main/LICENSE)
