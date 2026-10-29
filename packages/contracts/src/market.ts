/**
 * 市场条目的形状校验（D8 之后的市场契约）。
 *
 * 这份 schema 只有一个读者：看板在 `list` 回来之后逐条校验，不合格的条目列成不可用并写明原因。
 * 它不在 `./service` 的类型入口上——那里只有类型；提供方不需要它，市场实现按 `MarketListing`
 * 的类型自己产出条目。
 */
import { LOCALIZED_TEXT_SCHEMA, WIDGET_NAMESPACED_ID_PATTERN, WIDGET_REQUIRES_SCHEMA } from './widget'

/** 校验市场条目用的 JSON Schema；与 `service-types.ts` 的 `MarketListing` 一一对应。 */
export const MARKET_LISTING_SCHEMA = {
  $id: 'https://dsh-widget-board/market-listing.json',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'author', 'versions'],
  properties: {
    // 与市场来源的 manifest 与浏览器侧新把手同一条作者域规则（D8、D30），不再各写一份。
    id: { type: 'string', pattern: WIDGET_NAMESPACED_ID_PATTERN },
    title: { $ref: '#/$defs/text' },
    description: { $ref: '#/$defs/text' },
    author: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 },
        url: { type: 'string', maxLength: 2048 },
      },
    },
    license: { type: 'string', maxLength: 80 },
    versions: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['version', 'sizes', 'package'],
        properties: {
          version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' },
          sizes: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
          // 与 manifest 的 requires 同一个 schema（D30）：版本要求只有一种写法。
          requires: WIDGET_REQUIRES_SCHEMA,
          declares: {
            type: 'object',
            additionalProperties: false,
            properties: {
              capabilities: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 80 } },
              credentials: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 128 } },
              hosts: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 256 } },
            },
          },
          package: {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'sha256', 'bytes'],
            properties: {
              url: { type: 'string', minLength: 1, maxLength: 2048 },
              sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
              bytes: { type: 'integer', minimum: 1, maximum: 8 * 1024 * 1024 },
            },
          },
          changelog: { type: 'string', maxLength: 4096 },
        },
      },
    },
  },
  $defs: {
    text: LOCALIZED_TEXT_SCHEMA,
  },
} as const
