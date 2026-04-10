<div align="center">
	<h1>亞尼克 YTM 庫存查詢</h1>
	<p align="center">
		<img src="https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11" />
		<img src="https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
		<img src="https://img.shields.io/badge/Astro-6.1-FF5D01?style=flat-square&logo=astro&logoColor=white" alt="Astro" />
		<img src="https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
		<img src="coverage.svg" alt="Coverage report" />
	</p>
	<img src="./.github/assets/demo-page.png" alt="Demo screenshot" />
</div>

<div align="center">
	<p><strong>以商品為核心，快速定位仍有現貨的 YTM 站點。</strong></p>
	<p align="center">使用 FastAPI + Astro 建立商品反向索引，整合網站查詢與 API 服務，更有效率地掌握全台 YTM 庫存分布。</p>
</div>

<p align="center">
	<a href="https://yannick.purr.tw/">🌐 網站查詢</a>
	·
	<a href="https://yannick.purr.tw/docs">📄 API 文件</a>
</p>


## <a id="features"></a>✨ 功能亮點

- **商品導向的查詢流程**：從商品出發，直接定位仍有現貨的 YTM 站點，降低逐站查找成本。

- **完整掌握庫存分布與規模**：同時查看可購買站點與總庫存量，判斷購買時機更有效率。

- **網站與 API 並行提供**：可直接使用網頁查詢，也能整合到自建工具、通知流程或資料分析。

- **兼顧效率、穩定性與來源負載**：內建快取、限流與重試機制，在查詢速度與來源友善度之間取得平衡。

## <a id="quick-start"></a>🚀 快速開始

### 本地開發環境

1. 建立 Python 環境

	```bash
	python3 -m venv .venv
	source .venv/bin/activate
	pip install -r requirements.txt
	```

2. 安裝前端依賴並建置

	> ⚠️ 需要 Node.js >= 22.12.0

	```bash
	cd web
	npm install
	npm run build
	cd ..
	```

3. 建立環境變數檔

	```bash
	cp .env.example .env
	```

	預設值已足夠本機執行；一般使用情境直接沿用 `.env.example` 即可。

4. 啟動服務

	```bash
	uvicorn app.main:app --reload --port 8080
	```

	第一次啟動會自動掃描全台站點並建立初始索引，通常約需 30 秒左右。

5. 打開介面

   - Web 查詢介面： [http://localhost:8080](http://localhost:8080)

   - API 文件： [http://localhost:8080/docs](http://localhost:8080/docs)

### 🐳 Docker

如果只想快速啟動整套服務，可直接使用 Docker：

```bash
cp .env.example .env
docker build -t yannick-stock-checker .
docker run --rm -p 8080:8080 --env-file .env yannick-stock-checker
```

容器內會先提供 Astro build 後的靜態檔，再由 FastAPI 對外提供同一個服務入口。

## <a id="config"></a>⚙️ 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `CACHE_TTL_SECONDS` | `600` | 快取有效期（秒） |
| `MAX_CONCURRENT_REQUESTS` | `5` | 最大併發請求數 |
| `REQUEST_DELAY_SECONDS` | `0.2` | 每次請求間隔（秒） |
| `REQUEST_TIMEOUT_SECONDS` | `20.0` | 單次請求 timeout（秒） |
| `RETRY_MAX_ATTEMPTS` | `3` | 最大重試次數 |
| `RETRY_INITIAL_BACKOFF` | `1.0` | 初始退避時間（秒） |
| `RETRY_MAX_BACKOFF` | `8.0` | 最大退避時間（秒） |
| `DB_PATH` | `data/yannick_stock.db` | SQLite 資料庫路徑 |
| `HOST` | `0.0.0.0` | Server 綁定主機 |
| `PORT` | `8080` | Server 監聽埠 |
| `LOG_LEVEL` | `INFO` | 應用程式日誌等級 |

完整範例請見 [.env.example](.env.example)。若沒有特殊需求，保留預設值即可！

## <a id="api"></a>📡 API 概覽

| Method | Path | 說明 |
| --- | --- | --- |
| `GET` | `/api/products` | 回傳所有商品清單與總庫存資訊 |
| `GET` | `/api/products/{code}` | 查詢單一商品可購買的所有站點 |
| `GET` | `/api/stations` | 列出所有站點清單 |
| `GET` | `/api/stations/{tid}` | 查詢單一站點的庫存內容 |
| `POST` | `/api/refresh` | 手動刷新快取與聚合資料 |
| `GET` | `/api/status` | 取得目前系統狀態與更新時間 |

完整 API 文件 與回應格式請直接參考 [https://yannick.purr.tw/docs](https://yannick.purr.tw/docs)。

## <a id="testing"></a>🧪 測試

- 後端測試：

	```bash
	source .venv/bin/activate
	pytest -q
	```

- 前端測試：

	```bash
	cd web
	npm run test
	```

## <a id="notes"></a>⚠️ 注意事項

- 本專案為非官方工具，與亞尼克無官方關聯；相關商標與品牌名稱權利仍屬原權利人所有。

- 資料來源仰賴非公開 API，格式與可用性可能隨時變動。

- 系統已加入快取、限流與重試；使用前仍請自行評估風險，並遵守來源網站條款與頻率限制。

## <a id="license"></a>📄 License

本專案採用 [MIT License](LICENSE) 授權，詳見 [LICENSE](LICENSE)。
