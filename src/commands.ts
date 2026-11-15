import { Context, Logger, Session, $ } from 'koishi'
import {
  defaultConfig,
  extractChannelIds,
  extractUserIds,
  formatDate,
  generateCode,
  getBatchStatus,
  normalizeCode,
  parseTimeSpec,
  type CdkBatch,
  type ResolvedConfig,
} from './core'

interface CommandDeps {
  ctx: Context
  config: ResolvedConfig
  logger: Logger
}

function uidOf(session: Session): number | null {
  const uid = Number((session.user as { id?: number } | undefined)?.id)
  return Number.isFinite(uid) && uid > 0 ? uid : null
}

function deny(config: ResolvedConfig, verbose: string): string {
  return config.verboseError ? verbose : '兑换码无效或已失效。'
}

function describeBatch(batch: CdkBatch): string {
  const status = getBatchStatus(batch)
  return [
    `【${batch.name}】（${status}）`,
    `口令：${batch.code}`,
    `每份 ${batch.amount} ${batch.currency}，共 ${batch.totalShares} 份（已兑 ${batch.usedShares}）`,
    `有效期：${formatDate(new Date(batch.startsAt))} ~ ${formatDate(new Date(batch.expiresAt))}`,
    `每人限兑：${batch.maxPerUser} 次`,
    batch.allowedUsers.length ? `指定用户：${batch.allowedUsers.join(', ')}` : '指定用户：不限',
    batch.allowedChannels.length ? `限定频道：${batch.allowedChannels.join(', ')}` : '限定频道：不限',
    batch.note ? `备注：${batch.note}` : '',
  ].filter(Boolean).join('\n')
}

export function registerCommands({ ctx, config, logger }: CommandDeps) {
  // ---------- 帮助 ----------
  ctx.command('cdk.help', '查看兑换码插件帮助')
    .action(() => [
      '📦 兑换码插件（monetary-cdk）',
      '',
      '【用户】',
      'cdk <口令> — 兑换指定口令的货币奖励',
      '',
      '【管理员（authority 3）】',
      'cdk.create -n <名称> -a <数额> [-c <口令>] [-t <份数>] [-e <时效>] [-s <生效时间>] [-u <用户>] [-p <频道>] [-m <每人限兑>] --currency <单位> --note <备注> -y',
      '　· -u / -p 为贪婪参数，须放在最后；未指定 -c 时自动随机生成口令',
      'cdk.list [-a] — 查看兑换码列表（-a 含已结束）',
      'cdk.info <口令> — 查看批次详情与兑换明细',
      'cdk.toggle <口令> — 启用/停用',
      'cdk.delete <口令> [-y] — 删除（流水保留）',
      '',
      '【提示】',
      '· 插件配置页的“静态兑换码”会在每次启动时同步进数据库',
      `· 未指定时效时默认 ${config.defaultExpireDays} 天，每码每人默认限兑 ${config.defaultMaxPerUser} 次`,
    ].join('\n'))

  // ---------- 用户兑换 ----------
  ctx.command('cdk <code:string>', '兑换货币兑换码')
    .userFields(['id'])
    .action(async ({ session }, rawCode) => {
      if (!session?.userId) return '无法获取会话信息。'
      if (!rawCode?.trim()) return '请提供兑换口令，例如：cdk ABC12345'

      const uid = uidOf(session)
      if (uid == null) return '无法获取用户数字 ID，请先与机器人完成绑定。'

      const code = normalizeCode(rawCode, config.caseInsensitive)
      const [batch] = await ctx.database.get('cdk_batch', { code })
      if (!batch) return deny(config, '兑换码无效或已失效。')

      const now = new Date()
      if (!batch.enabled) return deny(config, '该兑换码已被停用。')
      if (now < new Date(batch.startsAt)) return deny(config, '该兑换码尚未开始，请稍后再试。')
      if (now > new Date(batch.expiresAt)) return deny(config, '该兑换码已过期。')
      if (batch.usedShares >= batch.totalShares) return deny(config, '该兑换码的份数已被兑换完毕。')

      if (batch.allowedUsers.length && !batch.allowedUsers.includes(session.userId)) {
        return deny(config, '你不在该兑换码的允许名单内。')
      }
      if (batch.allowedChannels.length && !batch.allowedChannels.includes(session.channelId)) {
        return deny(config, '该兑换码不能在当前频道使用。')
      }

      try {
        const paid = await ctx.database.transact(async (tx) => {
          // 事务内重读批次，防止并发兑换超发
          const [fresh] = await tx.get('cdk_batch', { id: batch.id })
          if (!fresh || !fresh.enabled) return false
          const nowTx = new Date()
          if (nowTx < new Date(fresh.startsAt) || nowTx > new Date(fresh.expiresAt)) return false
          if (fresh.usedShares >= fresh.totalShares) return false

          const mine = await tx.get('cdk_redemption', { batchId: fresh.id, uid })
          if (mine.length >= fresh.maxPerUser) return false

          await tx.create('cdk_redemption', {
            batchId: fresh.id,
            code: fresh.code,
            uid,
            userId: session.userId,
            platform: session.platform,
            channelId: session.channelId,
            amount: fresh.amount,
            createdAt: nowTx,
          })
          await tx.set('cdk_batch', { id: fresh.id }, (row) => ({
            usedShares: $.add(row.usedShares, 1),
          }))
          // 与 monetary.gain 相同的原子自增写入，纳入同一事务保证一致
          await tx.upsert('monetary', (row) => [{
            uid,
            currency: fresh.currency,
            value: $.add(row.value, fresh.amount),
          }])
          return true
        })

        if (!paid) return deny(config, '该兑换码已被兑换完毕，或你已达到限兑次数。')
      } catch (error) {
        logger.error('兑换失败：%o', error)
        return '兑换失败，请稍后再试。'
      }

      const [balance] = await ctx.database.get('monetary', { uid, currency: batch.currency }, ['value'])
      return [
        `兑换成功！【${batch.name}】+${batch.amount} ${batch.currency}`,
        `当前余额：${balance?.value ?? '？'} ${batch.currency}`,
      ].join('\n')
    })

  // ---------- 管理指令 ----------
  ctx.command('cdk.create', '创建兑换码（管理员）', { authority: 3 })
    .option('name', '-n <name:string> 活动名称')
    .option('amount', '-a <amount:number> 每份数额')
    .option('code', '-c <code:string> 指定口令（默认随机生成）')
    .option('shares', '-t <shares:number> 份数', { fallback: 1 })
    .option('expire', `-e <expire:string> 时效（默认 ${defaultConfig.defaultExpireDays} 天）`)
    .option('start', '-s <start:string> 生效时间（默认立即）')
    .option('users', '-u <users:text> 指定可兑换用户（@提及或逗号分隔；须放在最后）')
    .option('channels', '-p <channels:text> 限定频道 ID（须放在最后）')
    .option('maxPerUser', '-m <count:number> 每人限兑次数')
    .option('currency', '--currency <currency:string> 货币单位')
    .option('note', '--note <note:string> 备注')
    .option('yes', '-y 跳过确认')
    .action(async ({ session, options }) => {
      const amount = Number(options.amount)
      if (!Number.isFinite(amount) || amount <= 0) return '每份数额必须为正数。'
      const shares = Math.max(1, Math.floor(Number(options.shares) || 1))
      const maxPerUser = Math.max(1, Math.floor(Number(options.maxPerUser) || config.defaultMaxPerUser))
      const currency = options.currency?.trim() || config.currency

      const now = new Date()
      const startsAt = options.start ? parseTimeSpec(options.start, now) : now
      if (!startsAt) return '生效时间格式无法识别，支持 2026-11-20 / 2026-11-20 18:00。'

      const expiresAt = options.expire
        ? parseTimeSpec(options.expire, now)
        : new Date(now.getTime() + config.defaultExpireDays * 86_400_000)
      if (!expiresAt) return '时效格式无法识别，支持 30m / 12h / 7d / 2w 或绝对时间。'
      if (expiresAt <= startsAt) return '过期时间必须晚于生效时间。'

      let code = options.code ? normalizeCode(options.code, config.caseInsensitive) : ''
      if (code) {
        const [exists] = await ctx.database.get('cdk_batch', { code })
        if (exists) return `口令 ${code} 已被使用，请换一个。`
      }

      const allowedUsers = options.users ? extractUserIds(options.users) : []
      const allowedChannels = options.channels ? extractChannelIds(options.channels) : []

      const summary = [
        '即将创建兑换码：',
        `名称：${options.name}`,
        `每份：${amount} ${currency} × ${shares} 份`,
        `口令：${code || '（随机生成）'}`,
        `有效期：${formatDate(startsAt)} ~ ${formatDate(expiresAt)}`,
        `每人限兑：${maxPerUser} 次`,
        allowedUsers.length ? `指定用户：${allowedUsers.join(', ')}` : '指定用户：不限',
        allowedChannels.length ? `限定频道：${allowedChannels.join(', ')}` : '限定频道：不限',
        options.note ? `备注：${options.note}` : '',
      ].filter(Boolean).join('\n')

      if (!options.yes) {
        await session.send(summary + '\n\n输入「确认」完成创建，其他输入取消。')
        const answer = await session.prompt(30_000)
        if (!answer || !/^确认|confirm$/i.test(answer.trim())) return '已取消创建。'
      }

      // 未指定口令时随机生成并校验冲突
      let created = false
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        if (!code) code = generateCode(config.codeLength)
        try {
          await ctx.database.create('cdk_batch', {
            code,
            name: options.name,
            currency,
            amount,
            totalShares: shares,
            usedShares: 0,
            startsAt,
            expiresAt,
            maxPerUser,
            allowedUsers,
            allowedChannels,
            enabled: true,
            note: options.note ?? '',
            createdBy: session.userId,
            createdAt: new Date(),
          })
          created = true
        } catch (error) {
          if (options.code) return '口令已被占用，请换一个。'
          // 随机口令冲突则换一个再试
          code = ''
          if (attempt === 4) {
            logger.error('创建兑换码失败：%o', error)
            return '创建失败，请稍后再试。'
          }
        }
      }

      return `兑换码创建成功！\n口令：${code}\n${amount} ${currency} × ${shares} 份，${formatDate(expiresAt)} 过期`
    })

  ctx.command('cdk.list', '查看兑换码列表（管理员）', { authority: 3 })
    .option('all', '-a 包含已结束的兑换码')
    .action(async ({ options }) => {
      const batches = await ctx.database.get('cdk_batch', {}, {
        limit: 50,
        sort: { id: 'desc' },
      })
      const now = new Date()
      const rows = batches
        .map((batch) => ({ batch, status: getBatchStatus(batch, now) }))
        .filter(({ status }) => options.all || status === '进行中' || status === '待生效')
      if (!rows.length) return '当前没有进行中的兑换码。'
      return [
        '兑换码列表：',
        ...rows.map(({ batch, status }) =>
          `#${batch.id} [${status}] ${batch.name}｜${batch.code}｜${batch.amount}${batch.currency}×${batch.usedShares}/${batch.totalShares}｜${formatDate(new Date(batch.expiresAt))} 过期`),
      ].join('\n')
    })

  ctx.command('cdk.info <code:string>', '查看兑换码详情与兑换明细（管理员）', { authority: 3 })
    .action(async (_, code) => {
      const normalized = normalizeCode(code ?? '', config.caseInsensitive)
      const [batch] = await ctx.database.get('cdk_batch', { code: normalized })
      if (!batch) return '未找到该兑换码。'
      const records = await ctx.database.get('cdk_redemption', { batchId: batch.id }, {
        limit: 20,
        sort: { id: 'desc' },
      })
      const detail = records.length
        ? ['最近兑换：', ...records.map((r) =>
            `- ${r.userId}（uid ${r.uid}）${formatDate(new Date(r.createdAt))} 频道 ${r.channelId}`)]
        : ['暂无兑换记录。']
      return [describeBatch(batch), ...detail].join('\n')
    })

  ctx.command('cdk.toggle <code:string>', '启用/停用兑换码（管理员）', { authority: 3 })
    .action(async (_, code) => {
      const normalized = normalizeCode(code ?? '', config.caseInsensitive)
      const [batch] = await ctx.database.get('cdk_batch', { code: normalized })
      if (!batch) return '未找到该兑换码。'
      await ctx.database.set('cdk_batch', { id: batch.id }, { enabled: !batch.enabled })
      return `兑换码 ${batch.code} 已${batch.enabled ? '停用' : '启用'}。`
    })

  ctx.command('cdk.delete <code:string>', '删除兑换码，兑换流水保留（管理员）', { authority: 3 })
    .option('yes', '-y 跳过确认')
    .action(async ({ session, options }, code) => {
      const normalized = normalizeCode(code ?? '', config.caseInsensitive)
      const [batch] = await ctx.database.get('cdk_batch', { code: normalized })
      if (!batch) return '未找到该兑换码。'
      if (!options.yes) {
        await session.send(`确认删除兑换码 ${batch.code}【${batch.name}】？（已兑 ${batch.usedShares} 份，流水将保留）输入「确认」继续。`)
        const answer = await session.prompt(30_000)
        if (!answer || !/^确认|confirm$/i.test(answer.trim())) return '已取消。'
      }
      await ctx.database.remove('cdk_batch', { id: batch.id })
      return `兑换码 ${batch.code} 已删除。`
    })
}
