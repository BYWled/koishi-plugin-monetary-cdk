import { Context, Logger, Schema } from 'koishi'
import {} from 'koishi-plugin-monetary'
import { defaultConfig, normalizeCode, parseTimeSpec, type ResolvedConfig } from './core'
import { registerCommands } from './commands'

export const name = 'monetary-cdk'

export const inject = {
  required: ['database', 'monetary'],
}

const logger = new Logger('monetary-cdk')

declare module 'koishi' {
  interface Tables {
    cdk_batch: CdkBatch
    cdk_redemption: CdkRedemption
  }
}

export interface CdkBatch {
  id: number
  code: string
  name: string
  currency: string
  amount: number
  totalShares: number
  usedShares: number
  startsAt: Date
  expiresAt: Date
  maxPerUser: number
  allowedUsers: string[]
  allowedChannels: string[]
  enabled: boolean
  note: string
  createdBy: string
  createdAt: Date
}

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

export interface Config extends ResolvedConfig {
  /** 插件配置中静态定义的兑换码，启动时同步进 cdk_batch 表 */
  codes: StaticCode[]
}

/** 静态兑换码配置（与指令创建的兑换码共用 cdk_batch 表，usedShares 运行时状态保留） */
export interface StaticCode {
  code: string
  name: string
  amount: number
  totalShares: number
  maxPerUser: number
  /** 时效：相对时长（7d）或绝对时间（2026-12-31 23:59） */
  expire: string
  allowedUsers: string[]
  allowedChannels: string[]
  note: string
}

const expireDescription =
  '支持相对时长（30m / 12h / 7d / 2w）与绝对时间（2026-11-20 或 2026-11-20 18:00）'

const StaticCodeSchema = Schema.object({
  code: Schema.string().required().description('兑换口令（创建后可通过 cdk.toggle 停用）'),
  name: Schema.string().required().description('活动名称'),
  amount: Schema.number().required().description('每份数额'),
  totalShares: Schema.number().min(1).step(1).default(1).description('份数'),
  maxPerUser: Schema.number().min(1).step(1).default(1).description('每人限兑次数'),
  expire: Schema.string().description(`时效${expireDescription}；留空使用默认天数`),
  allowedUsers: Schema.array(String).role('table').description('允许兑换的用户（@提及或平台号，留空不限）'),
  allowedChannels: Schema.array(String).role('table').description('限定频道（留空不限）'),
  note: Schema.string().description('备注'),
})

export const Config: Schema<Config> = Schema.object({
  currency: Schema.string().default(defaultConfig.currency).description('默认货币单位'),
  defaultExpireDays: Schema.number()
    .min(0)
    .default(defaultConfig.defaultExpireDays)
    .description(`创建兑换码未指定时效时的默认天数（0 表示永不过期，仅建议内部码使用）`),
  defaultMaxPerUser: Schema.number()
    .min(1)
    .default(defaultConfig.defaultMaxPerUser)
    .description('默认每码每人限兑次数'),
  codeLength: Schema.number()
    .min(4)
    .max(32)
    .step(1)
    .default(defaultConfig.codeLength)
    .description('随机生成口令的长度'),
  caseInsensitive: Schema.boolean()
    .default(defaultConfig.caseInsensitive)
    .description('口令兑换是否不区分大小写'),
  verboseError: Schema.boolean()
    .default(defaultConfig.verboseError)
    .description('兑换失败时是否提示细化原因（关闭后统一提示，可防口令探测）'),
  codes: Schema.array(StaticCodeSchema).role('table').default([])
    .description('静态兑换码：启动时同步进数据库（已存在的只更新定义字段，已兑份数等运行时状态保留）'),
})

export function apply(ctx: Context, config: Config) {
  ctx.model.extend('cdk_batch', {
    id: 'unsigned',
    code: 'string',
    name: 'string',
    currency: 'string',
    amount: 'double',
    totalShares: 'unsigned',
    usedShares: 'unsigned',
    startsAt: 'timestamp',
    expiresAt: 'timestamp',
    maxPerUser: 'unsigned',
    allowedUsers: 'json',
    allowedChannels: 'json',
    enabled: 'boolean',
    note: 'string',
    createdBy: 'string',
    createdAt: 'timestamp',
  }, {
    autoInc: true,
    primary: 'id',
    unique: ['code'],
  })

  ctx.model.extend('cdk_redemption', {
    id: 'unsigned',
    batchId: 'unsigned',
    code: 'string',
    uid: 'unsigned',
    userId: 'string',
    platform: 'string',
    channelId: 'string',
    amount: 'double',
    createdAt: 'timestamp',
  }, {
    autoInc: true,
    primary: 'id',
    // 注意：不设 (batchId, uid) 唯一索引——maxPerUser 可大于 1；
    // 防超兑由兑换事务内的计数检查保证（sqlite 单写者串行）。
  })

  registerCommands({ ctx, config, logger })

  // 静态兑换码同步：缺失则创建，已存在则只更新定义字段（运行时状态保留）
  ctx.on('ready', async () => {
    if (!config.codes?.length) return
    let created = 0
    let updated = 0
    for (const item of config.codes) {
      try {
        const code = normalizeCode(item.code, config.caseInsensitive)
        if (!code) continue
        const now = new Date()
        const expiresAt = item.expire
          ? parseTimeSpec(item.expire, now)
          : new Date(now.getTime() + config.defaultExpireDays * 86_400_000)
        if (!expiresAt) {
          logger.warn('静态兑换码 %s 的时效格式无法识别，已跳过。', item.code)
          continue
        }
        const patch = {
          name: item.name,
          currency: config.currency,
          amount: item.amount,
          totalShares: Math.max(1, Math.floor(item.totalShares || 1)),
          expiresAt,
          maxPerUser: Math.max(1, Math.floor(item.maxPerUser || config.defaultMaxPerUser)),
          allowedUsers: item.allowedUsers ?? [],
          allowedChannels: item.allowedChannels ?? [],
          note: item.note ?? '',
        }
        const [existing] = await ctx.database.get('cdk_batch', { code })
        if (!existing) {
          await ctx.database.create('cdk_batch', {
            code,
            startsAt: now,
            usedShares: 0,
            enabled: true,
            createdBy: 'config',
            createdAt: now,
            ...patch,
          })
          created++
        } else {
          await ctx.database.set('cdk_batch', { id: existing.id }, patch)
          updated++
        }
      } catch (error) {
        logger.error('静态兑换码 %s 同步失败：%o', item.code, error)
      }
    }
    if (created || updated) {
      logger.info(`静态兑换码同步完成：新建 ${created} 个，更新 ${updated} 个。`)
    }
  })
}
