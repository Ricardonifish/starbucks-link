# Starbucks Link-in-Bio + AI 写评发表

本地 / Vercel 可部署的星巴克聚合落地页：社媒关注、AI 润色评价、确认发表。

## 本地启动

```bash
cd starbucks-link
npm install
copy .env.example .env
# 填写 ZHIPU_API_KEY
npm start
```

打开：http://localhost:5173

## 环境变量

| 变量 | 说明 |
|------|------|
| `ZHIPU_API_KEY` | 智谱免费 Key（推荐）https://bigmodel.cn/usercenter/proj-mgmt/apikeys |
| `ZHIPU_MODEL` | 默认 `glm-4-flash` |
| `SILICONFLOW_API_KEY` | 可选备用 |

Vercel 请在 Project → Settings → Environment Variables 中配置，**不要**把 `.env` 提交进 Git。

## 说明

确认发表会复制文案并打开对应平台；各平台无统一开放发帖 API。  
Vercel 上发表记录写入 `/tmp`，重启实例后可能清空。
