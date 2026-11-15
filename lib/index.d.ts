import { Context, Schema } from 'koishi';
import { type ResolvedConfig } from './core';
export declare const name = "monetary-cdk";
export declare const inject: {
    required: string[];
};
declare module 'koishi' {
    interface Tables {
        cdk_batch: CdkBatch;
        cdk_redemption: CdkRedemption;
    }
}
export interface CdkBatch {
    id: number;
    code: string;
    name: string;
    currency: string;
    amount: number;
    totalShares: number;
    usedShares: number;
    startsAt: Date;
    expiresAt: Date;
    maxPerUser: number;
    allowedUsers: string[];
    allowedChannels: string[];
    enabled: boolean;
    note: string;
    createdBy: string;
    createdAt: Date;
}
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
export interface Config extends ResolvedConfig {
    /** 插件配置中静态定义的兑换码，启动时同步进 cdk_batch 表 */
    codes: StaticCode[];
}
/** 静态兑换码配置（与指令创建的兑换码共用 cdk_batch 表，usedShares 运行时状态保留） */
export interface StaticCode {
    code: string;
    name: string;
    amount: number;
    totalShares: number;
    maxPerUser: number;
    /** 时效：相对时长（7d）或绝对时间（2026-12-31 23:59） */
    expire: string;
    allowedUsers: string[];
    allowedChannels: string[];
    note: string;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
