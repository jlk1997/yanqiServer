/** 可选独立静态服务；默认也可由 API 同端口托管 public */
const express = require('express');
const path = require('path');
const app = express();
const port = Number(process.env.WEB_PORT || 3200);
app.use(express.static(path.join(__dirname, 'public')));
app.listen(port, () => console.log(`研企通静态页: http://127.0.0.1:${port}`));
