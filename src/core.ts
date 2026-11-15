/** 兑换码批次（一次创建的一组口令） */
export interface CdkBatch {
  id: number
  /** 兑换口令 */
  code: string
  /** 活动名称 */
  name: string
  currency: string
  /** 每份数额 */
  amount: number
  /** 总份数 */
  totalShares: number
  /** 已兑换份数 */
  usedShares: number
  /** 生效时间 */
  startsAt: Date
  /** 过期时间 */
  expiresAt: Date
  /** 每人最多兑换份数 */
  maxPerUser: number
  /** 允许兑换的用户 ID（平台号），空数组表示不限 */
  allowedUsers: string[]
  /** 允许兑换的频道 ID，空数组表示不限 */
  allowedChannels: string[]
  enabled: boolean
  note: string
  createdBy: string
  createdAt: Date
}

/** 兑换流水（审计记录） */
export interface CdkRedemption {
  id: number
  batchId: number
  code: string
  uid: number
  userId: string
  platform: string
  channelId: string
  amount: number
  createdAt: Date
}

export interface ResolvedConfig {
  currency: string
  /** 创建兑换码时未指定 -e 的默认时效（天） */
  defaultExpireDays: number
  /** 默认每人限兑次数 */
  defaultMaxPerUser: number
  /** 随机口令长度 */
  codeLength: number
  /** 口令是否不区分大小写 */
  caseInsensitive: boolean
  /** 兑换失败时是否给出细化原因（关闭则统一提示，防口令探测） */
  verboseError: boolean
}

export const defaultConfig: ResolvedConfig = {
  currency: 'coin',
  defaultExpireDays: 7,
  defaultMaxPerUser: 1,
  codeLength: 8,
  caseInsensitive: false,
  verboseError: true,
}

/** 口令字符集：去除易混淆的 0/O/1/I/L */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateCode(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return result
}

export function normalizeCode(code: string, caseInsensitive: boolean): string {
  const trimmed = code.trim()
  return caseInsensitive ? trimmed.toUpperCase() : trimmed
}

/**
 * 解析时效/起始时间：
 * - 相对时长：30m / 12h / 7d / 2w
 * - 绝对时间：2026-11-20 或 2026-11-20 18:00（本地时区）
 */
export function parseTimeSpec(input: string, base = new Date()): Date | null {
  const value = input.trim()
  if (!value) return null

  const relative = /^(\d+)([mhdw])$/i.exec(value)
  if (relative) {
    const amount = Number(relative[1])
    const unit = relative[2].toLowerCase()
    const result = new Date(base)
    const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }
    result.setTime(result.getTime() + amount * multipliers[unit])
    return result
  }

  const absolute = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?$/.exec(value)
  if (absolute) {
    const [, y, mo, d, h = '0', mi = '0'] = absolute
    const result = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi))
    return Number.isNaN(result.getTime()) ? null : result
  }

  return null
}

export function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** 批次当前状态 */
export type BatchStatus = '待生效' | '进行中' | '已过期' | '已兑完' | '已停用'

export function getBatchStatus(batch: CdkBatch, now = new Date()): BatchStatus {
  if (!batch.enabled) return '已停用'
  if (now < new Date(batch.startsAt)) return '待生效'
  if (now > new Date(batch.expiresAt)) return '已过期'
  if (batch.usedShares >= batch.totalShares) return '已兑完'
  return '进行中'
}

/**
 * 从指令参数文本中提取平台用户 ID：
 * 支持 @提及（`<at id="..."/>` 元素）、`@用户名` 文本与空格/逗号分隔的纯数字。
 */
export function extractUserIds(text: string): string[] {
  const ids = new Set<string>()
  for (const match of text.matchAll(/<at[^>]*\bid=["']?([^"'\s/>]+)["']?[^>]*\/?>/g)) {
    if (match[1]) ids.add(match[1])
  }
  const stripped = text.replace(/<[^>]+>/g, ' ')
  for (const token of stripped.split(/[\s,，;；]+/)) {
    if (/^\d{3,}$/.test(token)) ids.add(token)
    else if (/^@(.+)$/.test(token)) ids.add(token.slice(1))
  }
  return [...ids]
}

export function extractChannelIds(text: string): string[] {
  const ids = new Set<string>()
  for (const token of text.replace(/<[^>]+>/g, ' ').split(/[\s,，;；]+/)) {
    if (token) ids.add(token)
  }
  return [...ids]
}
