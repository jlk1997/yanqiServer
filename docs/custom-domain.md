# 自定义域名解析桩

1. 运维台「租户/白标」填写 `customDomain`，例如 `tto.example.edu.cn`
2. DNS：CNAME 到平台入口（生产）；开发可：

```bash
echo '127.0.0.1 tto.example.edu.cn' | sudo tee -a /etc/hosts
# 或子域桩
echo '127.0.0.1 demo.yanqi.local' | sudo tee -a /etc/hosts
```

3. 请求带 `Host: demo.yanqi.local` 时，中间件解析到租户 code=`demo`
4. 公开接口：`GET /api/public/resolve-host?host=...`、`GET /api/public/branding`

`domainStatus` 目前为 `stub`；正式证书与自动验域留到 95%+ SaaS。
