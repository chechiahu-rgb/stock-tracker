<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import localforage from 'localforage'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'

// 註冊 Chart.js 組件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

// --- 資料庫設定 ---
localforage.config({ name: 'StockTrackerDB', storeName: 'transactions_store' })
const DB_KEY = 'tx_records'

// --- 響應式變數 ---
const totalAssetsTWD = ref(0)
const taiwanAssetsTWD = ref(0)
const usAssetsTWD = ref(0)
const totalRealizedPnLTWD = ref(0)

const taiwanTotalCost = ref(0)
const taiwanUnrealizedPnL = ref(0)
const usTotalCost = ref(0)
const usUnrealizedPnL = ref(0)

const transactions = ref([])
const taiwanPortfolio = ref([])
const usPortfolio = ref([])
const exchangeRate = ref(32.5)
const isCalculating = ref(false)
const currentTab = ref('TW')
const viewMode = ref('card')

const showForm = ref(false)
const selectedTickerModal = ref(null)
const formData = ref({
  ticker: '',
  date: new Date().toISOString().split('T')[0],
  type: '買進',
  shares: null,
  price: null,
  fee: 0,
  currency: 'TWD',
  dividendShares: 0,
  dividendCash: 0
})

// 圖表資料響應式變數
const chartData = ref({
  labels: [],
  datasets: []
})

const chartOptions = ref({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: 'top' }
  },
  scales: {
    y: { beginAtZero: false }
  }
})

// --- API 報價與名稱模組 ---
const fetchStockData = async (ticker) => {
  try {
    const targetUrl = `/yahoo/v8/finance/chart/${ticker}?interval=1d&range=1d`
    const response = await axios.get(targetUrl)
    const result = response.data.chart.result[0]
    
    return {
      price: result.meta.regularMarketPrice || 0,
      name: result.meta.longName || result.meta.shortName || ticker
    }
  } catch (error) {
    console.error(`獲取 ${ticker} 資料失敗:`, error)
    return { price: 0, name: ticker }
  }
}

// --- 核心金融演算法與歷史資產圖表計算 ---
const calculatePortfolio = async () => {
  isCalculating.value = true
  const summary = {}
  let realizedTWD = 0
  let realizedUSD = 0

  const sortedTx = [...transactions.value].sort((a, b) => new Date(a.date) - new Date(b.date))

  // 用於計算歷史資產走勢的時序紀錄
  const dailyAssetHistory = {}
  let runningSummary = {}

  sortedTx.forEach(tx => {
    if (!runningSummary[tx.ticker]) {
      runningSummary[tx.ticker] = { shares: 0, totalCost: 0, currency: tx.currency }
    }
    const item = runningSummary[tx.ticker]

    if (tx.type === '買進') {
      item.shares += tx.shares
      item.totalCost += (tx.price * tx.shares) + tx.fee
    } else if (tx.type === '賣出' && item.shares > 0) {
      const avgCostPerShare = item.totalCost / item.shares
      const sellShares = tx.shares
      const costOfSold = avgCostPerShare * sellShares
      const revenue = (tx.price * sellShares) - tx.fee
      const realizedPnL = revenue - costOfSold

      if (item.currency === 'USD') realizedUSD += realizedPnL
      else realizedTWD += realizedPnL

      item.shares -= sellShares
      item.totalCost -= costOfSold
      if (item.shares <= 0) { item.shares = 0; item.totalCost = 0; }
    } else if (tx.type === '配息') {
      if (tx.dividendShares) item.shares += Number(tx.dividendShares)
      if (tx.dividendCash) item.totalCost -= Number(tx.dividendCash)
    }

    // 簡易每日資產加總 (以歷史交易當下的投入成本作為趨勢描繪基礎)
    let dayTotalCost = 0
    for (const t in runningSummary) {
      const st = runningSummary[t]
      if (st.shares > 0) {
        let val = st.totalCost
        if (st.currency === 'USD') val *= 32.5 // 歷史趨勢簡化用預設匯率
        dayTotalCost += val
      }
    }
    dailyAssetHistory[tx.date] = dayTotalCost
  })

  // 重新整理目前的完整持股總覽
  sortedTx.forEach(tx => {
    if (!summary[tx.ticker]) {
      summary[tx.ticker] = { ticker: tx.ticker, name: tx.ticker, shares: 0, totalCost: 0, currency: tx.currency, totalDividendCash: 0 }
    }
    const item = summary[tx.ticker]
    if (tx.type === '買進') {
      item.shares += tx.shares
      item.totalCost += (tx.price * tx.shares) + tx.fee
    } else if (tx.type === '賣出' && item.shares > 0) {
      const avgCost = item.totalCost / item.shares
      item.shares -= tx.shares
      item.totalCost -= avgCost * tx.shares
    } else if (tx.type === '配息') {
      if (tx.dividendShares) item.shares += Number(tx.dividendShares)
      if (tx.dividendCash) item.totalCost -= Number(tx.dividendCash)
    }
  })

  const rateData = await fetchStockData('TWD=X')
  if (rateData.price > 0) exchangeRate.value = rateData.price

  totalRealizedPnLTWD.value = realizedTWD + (realizedUSD * exchangeRate.value)

  let totalTWD = 0
  let twTWD = 0
  let usTWD = 0
  let twCostSum = 0
  let twValueSum = 0
  let usCostSumTWD = 0
  let usValueSumTWD = 0

  const twList = []
  const usList = []

  for (const ticker in summary) {
    const item = summary[ticker]
    if (item.shares > 0) {
      const stockInfo = await fetchStockData(ticker)
      item.currentPrice = stockInfo.price
      item.name = stockInfo.name
      
      const avgCostPerShare = item.shares > 0 ? (item.totalCost / item.shares) : 0
      item.avgCost = avgCostPerShare
      item.unrealizedPnL = (item.currentPrice - avgCostPerShare) * item.shares
      item.marketValue = item.currentPrice * item.shares
      item.pnlPercent = item.totalCost > 0 ? (item.unrealizedPnL / item.totalCost) * 100 : 0

      if (item.currency === 'USD') {
        const marketValueTWD = item.marketValue * exchangeRate.value
        const totalCostTWD = item.totalCost * exchangeRate.value
        usTWD += marketValueTWD
        totalTWD += marketValueTWD
        usCostSumTWD += totalCostTWD
        usValueSumTWD += marketValueTWD
        usList.push(item)
      } else {
        twTWD += item.marketValue
        totalTWD += item.marketValue
        twCostSum += item.totalCost
        twValueSum += item.marketValue
        twList.push(item)
      }
    }
  }

  taiwanPortfolio.value = twList
  usPortfolio.value = usList
  taiwanAssetsTWD.value = twTWD
  usAssetsTWD.value = usTWD
  totalAssetsTWD.value = totalTWD

  taiwanTotalCost.value = twCostSum
  taiwanUnrealizedPnL.value = twValueSum - twCostSum

  usTotalCost.value = usCostSumTWD
  usUnrealizedPnL.value = usValueSumTWD - usCostSumTWD

  // 建立圖表資料
  const labels = Object.keys(dailyAssetHistory)
  const dataValues = Object.values(dailyAssetHistory)
  // 如果今天有最新市值，將今日點位補上
  const todayStr = new Date().toISOString().split('T')[0]
  if (!labels.includes(todayStr) && totalTWD > 0) {
    labels.push(todayStr)
    dataValues.push(totalTWD)
  }

  chartData.value = {
    labels: labels,
    datasets: [
      {
        label: '總資產走勢 (TWD)',
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
        borderColor: '#007aff',
        borderWidth: 2,
        data: dataValues,
        fill: true,
        tension: 0.2
      }
    ]
  }

  isCalculating.value = false
}

// --- 資料庫讀寫 ---
const loadTransactions = async () => {
  const savedData = await localforage.getItem(DB_KEY)
  if (savedData) transactions.value = savedData
  await calculatePortfolio()
}

const saveTransaction = async () => {
  let inputTicker = formData.value.ticker.toUpperCase().trim()
  const newTx = {
    id: crypto.randomUUID(),
    ticker: inputTicker,
    date: formData.value.date,
    type: formData.value.type,
    shares: Number(formData.value.shares) || 0,
    price: Number(formData.value.price) || 0,
    fee: Number(formData.value.fee) || 0,
    currency: formData.value.currency,
    dividendShares: Number(formData.value.dividendShares) || 0,
    dividendCash: Number(formData.value.dividendCash) || 0
  }

  transactions.value.push(newTx)
  await localforage.setItem(DB_KEY, JSON.parse(JSON.stringify(transactions.value)))
  
  showForm.value = false
  resetForm()
  await calculatePortfolio()
}

const deleteTransaction = async (id) => {
  transactions.value = transactions.value.filter(tx => tx.id !== id)
  await localforage.setItem(DB_KEY, JSON.parse(JSON.stringify(transactions.value)))
  await calculatePortfolio()
}

const resetForm = () => {
  formData.value = {
    ticker: '',
    date: new Date().toISOString().split('T')[0],
    type: '買進',
    shares: null,
    price: null,
    fee: 0,
    currency: 'TWD',
    dividendShares: 0,
    dividendCash: 0
  }
}

const filteredTransactions = computed(() => {
  if (!selectedTickerModal.value) return []
  return transactions.value.filter(tx => tx.ticker === selectedTickerModal.value)
})

onMounted(() => {
  loadTransactions()
})
</script>

<template>
  <div class="app-container">
    <header>
      <h1>資產總覽</h1>
      <h2 v-if="!isCalculating">總市值：${{ totalAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</h2>
      <h2 v-else>結算中...</h2>

      <div class="sub-assets-box">
        <div class="market-summary-item">
          <span>台股市值：${{ taiwanAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</span>
          <br>
          <small>未實現：
            <strong :class="taiwanUnrealizedPnL >= 0 ? 'profit' : 'loss'">
              ${{ taiwanUnrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} 
              ({{ taiwanTotalCost > 0 ? ((taiwanUnrealizedPnL / taiwanTotalCost) * 100).toFixed(2) : 0 }}%)
            </strong>
          </small>
        </div>
        <div class="market-summary-item">
          <span>美股市值：${{ usAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</span>
          <br>
          <small>未實現：
            <strong :class="usUnrealizedPnL >= 0 ? 'profit' : 'loss'">
              ${{ usUnrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD 
              ({{ usTotalCost > 0 ? ((usUnrealizedPnL / usTotalCost) * 100).toFixed(2) : 0 }}%)
            </strong>
          </small>
        </div>
      </div>

      <div class="realized-pnl-box">
        <span>總已實現損益：</span>
        <strong :class="totalRealizedPnLTWD >= 0 ? 'profit' : 'loss'">
          ${{ totalRealizedPnLTWD.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} TWD
        </strong>
      </div>
      <div><small>匯率 USD/TWD: {{ exchangeRate.toFixed(2) }}</small></div>
    </header>

    <!-- 資產折線圖區塊 -->
    <section class="chart-section" v-if="chartData.labels.length > 0">
      <h3>資產歷史折線圖</h3>
      <div class="chart-container">
        <Line :data="chartData" :options="chartOptions" />
      </div>
    </section>

    <!-- 市場切換標籤 -->
    <div class="tab-container">
      <button :class="['tab-btn', currentTab === 'TW' ? 'active' : '']" @click="currentTab = 'TW'">台股市場</button>
      <button :class="['tab-btn', currentTab === 'US' ? 'active' : '']" @click="currentTab = 'US'">美股市場</button>
    </div>

    <!-- 檢視模式切換 -->
    <div class="view-mode-bar">
      <span>顯示模式：</span>
      <button :class="['mode-btn', viewMode === 'card' ? 'active-mode' : '']" @click="viewMode = 'card'">卡片檢視</button>
      <button :class="['mode-btn', viewMode === 'list' ? 'active-mode' : '']" @click="viewMode = 'list'">細項列表</button>
    </div>

    <main>
      <!-- 台股市場區塊 -->
      <section v-if="currentTab === 'TW'" class="portfolio">
        <h3>台股持股庫存</h3>
        <p v-if="taiwanPortfolio.length === 0" class="empty-msg">目前無台股庫存。</p>
        
        <div v-else-if="viewMode === 'card'" class="card-grid">
          <div v-for="stock in taiwanPortfolio" :key="stock.ticker" class="stock-card" @click="selectedTickerModal = stock.ticker">
            <div class="card-header">
              <div>
                <strong class="stock-name">{{ stock.name }}</strong> 
                <span class="stock-ticker">({{ stock.ticker }})</span>
              </div>
              <span>{{ stock.shares.toLocaleString() }} 股</span>
            </div>
            <div class="card-body">
              <p>現價：${{ stock.currentPrice.toFixed(2) }} TWD</p>
              <p>成本均價：${{ stock.avgCost.toFixed(2) }} TWD</p>
              <p :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                未實現損益：${{ stock.unrealizedPnL.toFixed(2) }} ({{ stock.pnlPercent.toFixed(2) }}%)
              </p>
            </div>
          </div>
        </div>

        <div v-else class="table-container">
          <table class="stock-table">
            <thead>
              <tr>
                <th>標的</th>
                <th>股數</th>
                <th>現價</th>
                <th>均價</th>
                <th>未實現損益</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="stock in taiwanPortfolio" :key="stock.ticker" @click="selectedTickerModal = stock.ticker">
                <td><strong>{{ stock.name }}</strong><br><small>{{ stock.ticker }}</small></td>
                <td>{{ stock.shares.toLocaleString() }}</td>
                <td>${{ stock.currentPrice.toFixed(2) }}</td>
                <td>${{ stock.avgCost.toFixed(2) }}</td>
                <td :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                  ${{ stock.unrealizedPnL.toFixed(0) }}<br>({{ stock.pnlPercent.toFixed(1) }}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 美股市場區塊 -->
      <section v-if="currentTab === 'US'" class="portfolio">
        <h3>美股持股庫存</h3>
        <p v-if="usPortfolio.length === 0" class="empty-msg">目前無美股庫存。</p>
        
        <div v-else-if="viewMode === 'card'" class="card-grid">
          <div v-for="stock in usPortfolio" :key="stock.ticker" class="stock-card" @click="selectedTickerModal = stock.ticker">
            <div class="card-header">
              <div>
                <strong class="stock-name">{{ stock.name }}</strong> 
                <span class="stock-ticker">({{ stock.ticker }})</span>
              </div>
              <span>{{ stock.shares.toLocaleString() }} 股</span>
            </div>
            <div class="card-body">
              <p>現價：${{ stock.currentPrice.toFixed(2) }} USD</p>
              <p>成本均價：${{ stock.avgCost.toFixed(2) }} USD</p>
              <p :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                未實現損益：${{ stock.unrealizedPnL.toFixed(2) }} USD ({{ stock.pnlPercent.toFixed(2) }}%)
              </p>
            </div>
          </div>
        </div>

        <div v-else class="table-container">
          <table class="stock-table">
            <thead>
              <tr>
                <th>標的</th>
                <th>股數</th>
                <th>現價</th>
                <th>均價</th>
                <th>未實現損益</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="stock in usPortfolio" :key="stock.ticker" @click="selectedTickerModal = stock.ticker">
                <td><strong>{{ stock.name }}</strong><br><small>{{ stock.ticker }}</small></td>
                <td>{{ stock.shares.toLocaleString() }}</td>
                <td>${{ stock.currentPrice.toFixed(2) }}</td>
                <td>${{ stock.avgCost.toFixed(2) }}</td>
                <td :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                  ${{ stock.unrealizedPnL.toFixed(0) }}<br>({{ stock.pnlPercent.toFixed(1) }}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 全部歷史交易紀錄 (暗色系風格) -->
      <section class="history-dark-section">
        <h3>全部歷史交易紀錄</h3>
        <p v-if="transactions.length === 0" class="empty-dark-msg">目前尚無交易紀錄。</p>
        <ul v-else class="tx-dark-list">
          <li v-for="tx in transactions.slice().reverse()" :key="tx.id" class="tx-dark-item">
            <div class="tx-info">
              <strong class="tx-ticker">{{ tx.ticker }}</strong>
              <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
              <br>
              <small class="tx-sub">{{ tx.date }} | 
                <span v-if="tx.type !== '配息'">{{ tx.shares }} 股 @ ${{ tx.price }} {{ tx.currency }}</span>
                <span v-else>配股: {{ tx.dividendShares }}股 / 現金股利: ${{ tx.dividendCash }}</span>
              </small>
            </div>
            <button @click="deleteTransaction(tx.id)" class="delete-dark-btn">刪除</button>
          </li>
        </ul>
      </section>
    </main>

    <!-- 浮動新增按鈕 -->
    <button @click="showForm = true" class="fab-button">+</button>

    <!-- 新增交易彈窗 -->
    <div v-if="showForm" class="modal-overlay">
      <div class="modal-content">
        <h3>新增紀錄</h3>
        <form @submit.prevent="saveTransaction">
          <div class="form-group"><label>代號 (台股請自帶 .TW)</label><input v-model="formData.ticker" type="text" required placeholder="如 2330.TW 或 NVDA"></div>
          <div class="form-group"><label>日期</label><input v-model="formData.date" type="date" required></div>
          <div class="form-group">
            <label>幣別</label>
            <select v-model="formData.currency">
              <option value="TWD">台幣 (TWD)</option>
              <option value="USD">美金 (USD)</option>
            </select>
          </div>
          <div class="form-group">
            <label>類型</label>
            <select v-model="formData.type">
              <option value="買進">買進</option>
              <option value="賣出">賣出</option>
              <option value="配息">配息 / 配股</option>
            </select>
          </div>

          <template v-if="formData.type !== '配息'">
            <div class="form-group"><label>股數</label><input v-model="formData.shares" type="number" step="any" required></div>
            <div class="form-group"><label>成交單價</label><input v-model="formData.price" type="number" step="any" required></div>
            <div class="form-group"><label>手續費</label><input v-model="formData.fee" type="number" step="any" required></div>
          </template>

          <template v-else>
            <div class="form-group"><label>獲得配股股數 (選填)</label><input v-model="formData.dividendShares" type="number" step="any" placeholder="0"></div>
            <div class="form-group"><label>總獲得現金股利 (選填)</label><input v-model="formData.dividendCash" type="number" step="any" placeholder="0"></div>
          </template>

          <div class="form-actions">
            <button type="button" @click="showForm = false" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">儲存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 個股歷史紀錄專屬彈窗 -->
    <div v-if="selectedTickerModal" class="modal-overlay" @click.self="selectedTickerModal = null">
      <div class="modal-content">
        <h3>{{ selectedTickerModal }} 歷史紀錄</h3>
        <ul class="tx-dark-list" style="margin-top: 15px;">
          <li v-for="tx in filteredTransactions.slice().reverse()" :key="tx.id" class="tx-dark-item">
            <div class="tx-info">
              <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
              <small class="tx-sub">{{ tx.date }} | 
                <span v-if="tx.type !== '配息'">{{ tx.shares }} 股 @ ${{ tx.price }}</span>
                <span v-else>配股: {{ tx.dividendShares }}股 / 現金: ${{ tx.dividendCash }}</span>
              </small>
            </div>
            <button @click="deleteTransaction(tx.id)" class="delete-dark-btn">刪除</button>
          </li>
        </ul>
        <button @click="selectedTickerModal = null" class="submit-btn" style="width: 100%; margin-top: 20px;">關閉</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container { font-family: sans-serif; padding: 16px; max-width: 600px; margin: 0 auto; padding-bottom: 80px; }
header { background-color: #f4f4f5; padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 15px; }

.sub-assets-box { display: flex; justify-content: space-around; margin: 12px 0; font-size: 0.95em; color: #333; background: #fff; padding: 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.market-summary-item { text-align: center; flex: 1; }
.market-summary-item:first-child { border-right: 1px solid #eee; }

.realized-pnl-box { margin: 8px 0; font-size: 1em; color: #333; background: #fff; padding: 6px 12px; border-radius: 6px; display: inline-block; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }

/* 折線圖區塊樣式 */
.chart-section { background: white; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid #e0e0e0; }
.chart-section h3 { margin-top: 0; font-size: 1.1em; color: #333; margin-bottom: 10px; }
.chart-container { position: relative; height: 220px; width: 100%; }

.tab-container { display: flex; margin-bottom: 10px; background: #e5e5ea; border-radius: 8px; padding: 4px; }
.tab-btn { flex: 1; padding: 10px; border: none; background: transparent; font-size: 16px; font-weight: bold; color: #666; cursor: pointer; border-radius: 6px; transition: 0.2s; }
.tab-btn.active { background: white; color: #007aff; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }

.view-mode-bar { display: flex; align-items: center; justify-content: flex-end; margin-bottom: 15px; font-size: 0.9em; color: #555; }
.mode-btn { margin-left: 6px; padding: 4px 10px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; font-size: 0.85em; }
.mode-btn.active-mode { background: #007aff; color: white; border-color: #007aff; }

.card-grid { display: grid; grid-template-columns: 1fr; gap: 15px; margin-bottom: 20px; }
.stock-card { background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); cursor: pointer; transition: transform 0.1s; }
.stock-card:hover { transform: scale(1.01); border-color: #007aff; }
.card-header { display: flex; justify-content: space-between; align-items: baseline; font-size: 1.1em; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 10px; }
.stock-name { font-size: 1.1em; color: #111; margin-right: 6px; }
.stock-ticker { font-size: 0.85em; color: #666; }
.card-body p { margin: 5px 0; font-size: 0.95em; color: #555; }

.table-container { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e0e0e0; margin-bottom: 20px; }
.stock-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9em; }
.stock-table th { background: #f8f9fa; padding: 10px; border-bottom: 1px solid #ddd; color: #333; }
.stock-table td { padding: 10px; border-bottom: 1px solid #eee; color: #444; cursor: pointer; }
.stock-table tr:hover { background: #f1f5f9; }

.history-dark-section { background: #1e293b; color: #f8fafc; padding: 20px; border-radius: 12px; margin-top: 30px; }
.history-dark-section h3 { margin-top: 0; color: #f1f5f9; border-bottom: 1px solid #334155; padding-bottom: 10px; }
.empty-dark-msg { color: #94a3b8; text-align: center; font-size: 0.9em; }
.tx-dark-list { list-style: none; padding: 0; margin: 0; }
.tx-dark-item { display: flex; justify-content: space-between; align-items: center; background: #0f172a; border: 1px solid #334155; padding: 12px; margin-bottom: 8px; border-radius: 8px; }
.tx-ticker { color: #ffffff; font-size: 1.05em; }
.tx-sub { color: #94a3b8; }
.tag-dark-buy { background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; margin-left: 6px; }
.tag-dark-sell { background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; margin-left: 6px; }
.tag-dark-div { background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; margin-left: 6px; }
.delete-dark-btn { background: #dc2626; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85em; }

.profit { color: #d32f2f !important; font-weight: bold; }
.loss { color: #388e3c !important; font-weight: bold; }

.fab-button { position: fixed; bottom: 30px; right: 30px; width: 60px; height: 60px; background-color: #007aff; color: white; border: none; border-radius: 50%; font-size: 30px; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.2); z-index: 100; }
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: flex-end; z-index: 1000; }
.modal-content { background: white; width: 100%; max-width: 600px; padding: 20px; border-radius: 20px 20px 0 0; box-shadow: 0 -2px 10px rgba(0,0,0,0.1); max-height: 85vh; overflow-y: auto; }
.form-group { margin-bottom: 15px; }
.form-group label { display: block; margin-bottom: 5px; font-size: 0.9em; color: #333; }
.form-group input, .form-group select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 16px; }
.form-actions { display: flex; justify-content: space-between; margin-top: 20px; }
.cancel-btn { padding: 12px 20px; background: #e5e5ea; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; width: 48%; }
.submit-btn { padding: 12px 20px; background: #007aff; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; width: 48%; }
</style>