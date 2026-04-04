# 🍰 亞尼克 YTM 庫存反向查詢系統

> 將亞尼克 YTM 販賣機的「據點 → 商品」查詢邏輯，反轉為「商品 → 據點」，讓你一秒找到想買的蛋糕在哪裡有貨。

## 📌 動機

亞尼克官方 [YTM 庫存查詢頁面](https://www.yannick.com.tw/ytm/service2) 採用「先選據點 → 再看庫存」的流程。  
想買某個特定商品時，必須**逐一點開所有站點**才能找到哪裡有貨——這太痛苦了。

本系統反轉查詢邏輯：**先列出所有商品 → 點選後立即看到所有有庫存的據點**。

## ✨ 功能

- 🔄 **反向索引**：自動掃描全台 60+ 個 YTM 站點，建立「商品 → 據點」索引
- ⚡ **TTL 快取**：10 分鐘 TTL 記憶體快取，避免頻繁請求官方 API
- 🚀 **RESTful API**：FastAPI 驅動，支援商品查詢、站點查詢、手動刷新
- 🛡️ **限流保護**：Semaphore 併發控制 + 請求間隔，對官方 API 友善
- 🔁 **指數退避重試**：失敗請求自動重試（Exponential Backoff + Full Jitter），提升資料完整性

## 🏗️ 架構

```
使用者 → FastAPI API → TTLCache → Aggregator → Scraper → 亞尼克官方 API
                                      ↓
                              反向索引（商品 → 站點）
```

## 🚀 快速開始

### 1. 建立虛擬環境

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 設定環境變數

```bash
cp .env.example .env
# 編輯 .env 填入必要的設定（Phase 1 & 2 不需要 Telegram Token）
```

### 3. 啟動 API Server

```bash
uvicorn app.main:app --reload --port 8080
```

啟動後會自動從亞尼克官方抓取資料（約需 30 秒完成全站掃描）。

### 4. 查看 API 文檔

打開瀏覽器前往：http://localhost:8080/docs

## 📡 API Endpoints

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/api/products` | 所有商品清單（含可用站點數、總庫存） |
| `GET` | `/api/products/{code}` | 特定商品在哪些站點有庫存 |
| `GET` | `/api/stations` | 所有站點清單（依據點分類分組） |
| `GET` | `/api/stations/{tid}` | 特定站點的庫存清單 |
| `POST` | `/api/refresh` | 手動觸發快取刷新 |
| `GET` | `/api/status` | 系統狀態（快取時間、站點數等） |

### 回應範例

#### `GET /api/products`

```json
{
  "products": [
    {
      "commodity_code": "31Z051011",
      "product_name": "(YTM) 【生乳捲盲盒】",
      "commodity_name": "生乳捲盲盒",
      "price": 420,
      "available_stations": 34,
      "total_quantity": 105
    }
  ],
  "last_updated": "2026-04-02T07:28:23+08:00",
  "total_products": 7
}
```

#### `GET /api/products/{code}`

```json
{
  "product": {
    "commodity_code": "31Z064078",
    "commodity_name": "巴斯克生起司",
    "price": 420
  },
  "stations": [
    {
      "station_id": "F7D4C41212D4F8",
      "station_name": "板南線-龍山寺站",
      "branch_name": "台北捷運據點",
      "quantity": 1
    }
  ],
  "total_quantity": 55
}
```

## 🧪 測試

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

共 18 個測試（scraper × 5 + aggregator × 5 + api × 8），使用 `respx` mock HTTP 請求。

## 📁 專案結構

```
yannick-stock-checker/
├── app/
│   ├── config.py              # 環境變數設定（pydantic-settings）
│   ├── main.py                # FastAPI 進入點 + lifespan 管理
│   ├── core/
│   │   ├── models.py          # 資料模型（Station, Product, etc.）
│   │   ├── scraper.py         # 爬蟲：站點清單 + 庫存 API
│   │   ├── aggregator.py      # 聚合器：反向索引建構
│   │   └── cache.py           # TTL 記憶體快取
│   ├── api/
│   │   └── routes.py          # RESTful API 路由 + Pydantic models
│   ├── bot/                   # Telegram Bot（Phase 4）
│   └── web/                   # Web 前端（Phase 3）
├── tests/
│   ├── test_scraper.py
│   ├── test_aggregator.py
│   └── test_api.py
├── .env.example
├── requirements.txt
└── pytest.ini
```

## ⚙️ 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `CACHE_TTL_SECONDS` | `600` | 快取有效期（秒） |
| `MAX_CONCURRENT_REQUESTS` | `5` | 爬蟲最大併發數 |
| `REQUEST_DELAY_SECONDS` | `0.2` | 每次請求間隔（秒） |
| `REQUEST_TIMEOUT_SECONDS` | `20.0` | 單次請求 timeout（秒） |
| `RETRY_MAX_ATTEMPTS` | `3` | 失敗重試次數上限 |
| `RETRY_INITIAL_BACKOFF` | `1.0` | 初始退避時間（秒） |
| `RETRY_MAX_BACKOFF` | `8.0` | 退避時間上限（秒） |
| `PORT` | `8080` | Server 監聽埠 |
| `TELEGRAM_BOT_TOKEN` | - | Telegram Bot Token（Phase 4） |
| `WEBHOOK_URL` | - | Cloud Run Webhook URL（Phase 5） |

### 🔁 重試策略

採用 [Google Cloud 推薦的指數退避演算法](https://docs.cloud.google.com/iam/docs/retry-strategy?hl=zh-tw)（Exponential Backoff + Full Jitter）：

```
wait = random(0, min(max_backoff, initial_backoff × 2^attempt))
```

**觸發條件**：
- `TimeoutException`（ReadTimeout, ConnectTimeout）
- `ConnectError`（連線失敗）
- HTTP 5xx Server Error

**預設行為**：最多重試 3 次，退避 1s → 2s → 4s（加隨機 jitter），上限 8s。  
**實測改善**：成功率從 56/66 站 → 63/66 站 ↑

## 🗺️ Roadmap

- [x] **Phase 1**：核心引擎（Scraper + Aggregator + Cache）
- [x] **Phase 2**：API 服務（FastAPI + RESTful Endpoints）
- [x] **Phase 3**：Web 前端（HTML/JS/CSS 查詢介面 + 響應式 Modal）
- [ ] ~~**Phase 4**：Telegram Bot（InlineKeyboard 互動查詢）~~ *(目前暫停：認為網頁版已滿足需求)*
- [ ] **Phase 5**：部署（Docker + Cloud Run + CI/CD）

## ⚠️ 注意事項

- 亞尼克的 `ajaxTYTMStock.ashx` 是非公開 API，隨時可能更改格式或增加防爬措施
- 全量掃描約 66 個站點，已透過 Semaphore + delay 做限流保護
- 部分站點（尤其高雄捷運據點）偶爾回應緩慢，系統會自動重試（最多 3 次指數退避）
- 所有重試耗盡後仍失敗的站點會 gracefully 回傳空庫存，不影響其他站點結果

## ☁️ 部署 (Google Cloud Run)

本專案支援無痛部署至 Google Cloud Run，後端 FastAPI 與前端 Astro 靜態網站將被打包為單一 Docker 映像檔。

**推薦部署方式 (從 GCP Console 操作)：**
1. 將本專案的所有程式碼（包含 `Dockerfile`） Push 到你的 GitHub Repository。
2. 進入 Google Cloud Console 的 **Cloud Run**。
3. 點選 **「建立服務」**，選擇 **「從原始碼存放區持續部署新修訂版本」**。
4. 授權 GitHub，選擇此專案的 Repo。
5. 建構環境選擇 `Dockerfile`，其餘按下一步即可**一鍵部署完成**。
*(後續只要 `git push` 到主要分支，GCP 就會自動觸發更新！)*

**💡 溫馨提示 (避免冷啟動)：**
因 Cloud Run 預設為 Serverless（自動縮放至零），若無人訪問時關機，第一位訪客將遭遇 10~20 秒的零快取「首抽等待」。
若要避免此狀況，推薦免費設定一個 **Cloud Scheduler**，每 9 分鐘以 HTTP GET 戳一次 `/api/products` 網址，讓機器永不沉睡並隨時保持快取常駐！

## 📄 License

MIT
