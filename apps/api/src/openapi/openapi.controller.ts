import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { openApiDoc } from './openapi.doc';

@Controller()
export class OpenApiController {
  @Get('openapi.json')
  @Header('Cache-Control', 'public, max-age=60')
  json() {
    return openApiDoc;
  }

  @Get('docs')
  docs(@Res() res: Response) {
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>研企通 API 文档</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0;background:#0b1220;color:#e8eefc} .top{padding:12px 18px;font-family:system-ui,sans-serif} a{color:#8ec5ff}</style>
</head>
<body>
  <div class="top">研企通 OpenAPI · <a href="/api/openapi.json">openapi.json</a> · 手维护，跟关键路由走 · <a href="/">回运维台</a></div>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>`;
    res.type('html').send(html);
  }
}
