/** 手维护 OpenAPI 3.0：与关键路由保持同步；新增对外接口时请改这里 */
export const openApiDoc = {
  openapi: '3.0.3',
  info: {
    title: '研企通 API',
    description:
      '研企通公开与鉴权接口摘要。生产请用 JWT（Authorization: Bearer）或 ADMIN_API_KEY。伙伴 Webhook 出站见 /api/webhooks/status。',
    version: '0.15.0',
  },
  servers: [{ url: '/api', description: '相对当前主机' }],
  tags: [
    { name: 'health' },
    { name: 'auth' },
    { name: 'matches' },
    { name: 'leads' },
    { name: 'portal' },
    { name: 'webhooks' },
    { name: 'lineage' },
    { name: 'search' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['health'],
        summary: '健康与成熟度',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: '登录',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string' }, password: { type: 'string' } },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: { '200': { description: 'token + user' } },
      },
    },
    '/matches': {
      get: {
        tags: ['matches'],
        summary: '匹配列表',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'minScore', in: 'query', schema: { type: 'number' } },
        ],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'MatchResult[]' } },
      },
    },
    '/matches/{id}': {
      get: {
        tags: ['matches'],
        summary: '匹配详情',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'MatchResult' } },
      },
      patch: {
        tags: ['matches'],
        summary: '更新匹配状态（通过会触发 match.approved webhook）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { status: { type: 'string' }, operatorNote: { type: 'string' } },
              },
            },
          },
        },
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'updated' } },
      },
    },
    '/leads/{id}/approve-send': {
      post: {
        tags: ['leads'],
        summary: '审核并发送线索（触发 lead.sent webhook；真发需 SMTP 双确认）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'dry_run | smtp | failed' } },
      },
    },
    '/portal/my-deals/{id}/move': {
      post: {
        tags: ['portal'],
        summary: '门户看板挪列（触发 deal.moved webhook）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/webhooks/status': {
      get: {
        tags: ['webhooks'],
        summary: '伙伴 Webhook 配置状态（公开可读摘要）',
        responses: { '200': { description: 'live/url/secret flags' } },
      },
    },
    '/webhooks/deliveries': {
      get: {
        tags: ['webhooks'],
        summary: '投递日志',
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'WebhookDelivery[]' } },
      },
    },
    '/webhooks/self-test': {
      post: {
        tags: ['webhooks'],
        summary: '自测投递（默认干跑）',
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'delivery' } },
      },
    },
    '/lineage/match/{id}': {
      get: {
        tags: ['lineage'],
        summary: '匹配/卡血缘与编辑轨迹',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'lineage panel payload' } },
      },
    },
    '/lineage/card': {
      get: {
        tags: ['lineage'],
        summary: '单卡血缘',
        parameters: [
          { name: 'kind', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'card lineage' } },
      },
    },
    '/search': {
      get: {
        tags: ['search'],
        summary: '统一搜索',
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        responses: { '200': { description: 'hits' } },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['health'],
        summary: '本文件',
        responses: { '200': { description: 'OpenAPI 3 document' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
  },
} as const;
