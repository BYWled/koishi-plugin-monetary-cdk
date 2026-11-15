/** 兑换码批次（一次创建的一组口令） */
export interface CdkBatch {
    id: number;
    /** 兑换口令 */
    code: string;
    /** 活动名称 */
    name: string;
    currency: string;
    /** 每份数额 */
    amount: number;
    /** 总份数 */
    totalShares: number;
    /** 已兑换份数 */
    usedShares: number;
    /** 生效时间 */
    startsAt: Date;
    /** 过期时间 */
    expiresAt: Date;
    /** 每人最多兑换份数 */
    maxPerUser: number;
    /** 允许兑换的用户 ID（平台号），空数组表示不限 */
    allowedUsers: string[];
    /** 允许兑换的频道 ID，空数组表示不限 */
    allowedChannels: string[];
    enabled: boolean;
    note: string;
    createdBy: string;
    createdAt: Date;
}
/** 兑换流水（审计记录） */
export interface CdkRedemption {
    id: number;
    batchId: number;
    code: string;
    uid: number;
    userId: string;
    platform: string;
    channelId: string;
    amount: number;
    createdAt: Date;
}
export interface ResolvedConfig {
    currency: string;
    /** 创建兑换码时未指定 -e 的默认时效（天） */
    defaultExpireDays: number;
    /** 默认每人限兑次数 */
    defaultMaxPerUser: number;
    /** 随机口令长度 */
    codeLength: number;
    /** 口令是否不区分大小写 */
    caseInsensitive: boolean;
    /** 兑换失败时是否给出细化原因（关闭则统一提示，防口令探测） */
    verboseError: boolean;
}
export declare const defaultConfig: ResolvedConfig;
export declare function generateCode(length: number): string;
export declare function normalizeCode(code: string, caseInsensitive: boolean): string;
/**
 * 解析时效/起始时间：
 * - 相对时长：30m / 12h / 7d / 2w
 * - 绝对时间：2026-11-20 或 2026-11-20 18:00（本地时区）
 */
export declare function parseTimeSpec(input: string, base?: Date): Date | null;
export declare function formatDate(date: Date): string;
/** 批次当前状态 */
export type BatchStatus = '待生效' | '进行中' | '已过期' | '已兑完' | '已停用';
export declare function getBatchStatus(batch: CdkBatch, now?: Date): BatchStatus;
/**
 * 从指令参数文本中提取平台用户 ID：
 * 支持 @提及（`<at id="..."/>` 元素）、`@用户名` 文本与空格/逗号分隔的纯数字。
 */
export declare function extractUserIds(text: string): string[];
export declare function extractChannelIds(text: string): string[];
