<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import localforage from 'localforage'
import { Line, Bar } from 'vue-chartjs'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartDataLabels
)

// --- 資料庫設定 ---
localforage.config({ name: 'StockTrackerDB', storeName: 'transactions_store' })
const DB_KEY = 'tx_records'
const TARGET_DB_KEY = 'stock_targets' // 目標價與警戒線資料庫

// --- 響應式變數 ---
const totalAssetsTWD = ref(0)
const taiwanAssetsTWD = ref(0)
const usAssetsTWD = ref(0)
const totalRealizedPnLTWD = ref(0)

const taiwanTotalCost = ref(0)
const taiwanUnrealizedPnL = ref(0)
const usTotalCost = ref(0)
const usUnrealizedPnL = ref(0)

const totalDividendCashTWD = ref(0)
const yearlyDividendSummary = ref({}) // 各年度股利統計

const transactions = ref([])
const taiwanPortfolioRaw = ref([])
const usPortfolioRaw = ref([])
const exchangeRate = ref(32.5)
const isCalculating = ref(false)
const currentTab = ref('TW')
const viewMode = ref('card')
const sortOption = ref('value')

// 標的自訂目標價與警戒線儲存表 { ticker: { targetPrice: 1000, stopPrice: 500 } }
const stockTargets = ref({})

// 圖表控制變數
const isChartOpen = ref(true)
const chartType = ref('line')
const barMarketTab = ref('TW')

const showForm = ref(false)
const showTargetModal = ref(false)
const selectedTickerModal = ref(null)
const targetFormTicker = ref('')
const targetFormVal = ref({ targetPrice: '', stopPrice: '' })

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

// 折線圖與長條圖設定
const lineChartData = ref({ labels: [], datasets: [] })
const lineChartOptions = ref({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: true, position: 'top' }, datalabels: { display: false } },
  scales: { y: { beginAtZero: false } }
})

const barChartData = ref({ labels: [], datasets: [] })
const barChartOptions = ref({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: true },
    datalabels: {
      color: '#ffffff',
      font: { weight: 'bold', size: 11 },
      anchor: 'start',
      align: 'end',
      formatter: (value, context) => {
        const dataset = context.chart.data.datasets[0].data
        const total = dataset.reduce((acc, val) => acc + val, 0)
        if (total === 0) return '0%'
        return ((value / total) * 100).toFixed(1) + '%'
      }
    }
  },
  scales: { y: { beginAtZero: true } }
})

// --- 排序計算屬性 ---
const taiwanPortfolio = computed(() => {
  const list = [...taiwanPortfolioRaw.value]
  if (sortOption.value === 'ticker') return list.sort((a, b) => a.ticker.localeCompare(b.ticker))
  if (sortOption.value === 'shares') return list.sort((a, b) => b.shares - a.shares)
  return list.sort((a, b) => b.marketValue - a.marketValue)
})

const usPortfolio = computed(() => {
  const list = [...usPortfolioRaw.value]
  if (sortOption.value === 'ticker') return list.sort((a, b) => a.ticker.localeCompare(b.ticker))
  if (sortOption.value === 'shares') return list.sort((a, b) => b.shares - a.shares)
  return list.sort((a, b) => b.marketValue - a.marketValue)
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

// --- 核心金融演算法與股利統計計算 ---
const calculatePortfolio = async () => {
  isCalculating.value = true
  const summary = {}
  let realizedTWD = 0
  let realizedUSD = 0
  let totalDivTWD = 0
  let yearlyDivs = {}

  const sortedTx = [...transactions.value].sort((a, b) => new Date(a.date) - new Date(b.date))
  const dailyAssetHistory = {}
  let runningSummary = {}

  sortedTx.forEach(tx => {
    const year = tx.date ? tx.date.split('-')[0] : '未知年份'

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
      if (tx.dividendCash) {
        const cashVal = Number(tx.dividendCash)
        item.totalCost -= cashVal
        const cashInTWD = tx.currency === 'USD' ? cashVal * 32.5 : cashVal
        totalDivTWD += cashInTWD
        
        if (!yearlyDivs[year]) yearlyDivs[year] = 0
        yearlyDivs[year] += cashInTWD
      }
    }

    let dayTotalCost = 0
    for (const t in runningSummary) {
      const st = runningSummary[t]
      if (st.shares > 0) {
        let val = st.totalCost
        if (st.currency === 'USD') val *= 32.5
        dayTotalCost += val
      }
    }
    dailyAssetHistory[tx.date] = dayTotalCost
  })

  // 重新整理目前持股狀態
  sortedTx.forEach(tx => {
    if (!summary[tx.ticker]) {
      summary[tx.ticker] = { ticker: tx.ticker, name: tx.ticker, shares: 0, totalCost: 0, currency: tx.currency }
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
  totalDividendCashTWD.value = totalDivTWD
  yearlyDividendSummary.value = yearlyDivs

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

      // 綁定目標價與警戒線
      const tSetting = stockTargets.value[ticker] || {}
      item.targetPrice = tSetting.targetPrice ? Number(tSetting.targetPrice) : null
      item.stopPrice = tSetting.stopPrice ? Number(tSetting.stopPrice) : null

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

  taiwanPortfolioRaw.value = twList
  usPortfolioRaw.value = usList
  taiwanAssetsTWD.value = twTWD
  usAssetsTWD.value = usTWD
  totalAssetsTWD.value = totalTWD

  taiwanTotalCost.value = twCostSum
  taiwanUnrealizedPnL.value = twValueSum - twCostSum
  usTotalCost.value = usCostSumTWD
  usUnrealizedPnL.value = usValueSumTWD - usCostSumTWD

  const labels = Object.keys(dailyAssetHistory)
  const dataValues = Object.values(dailyAssetHistory)
  const todayStr = new Date().toISOString().split('T')[0]
  if (!labels.includes(todayStr) && totalTWD > 0) {
    labels.push(todayStr)
    dataValues.push(totalTWD)
  }

  lineChartData.value = {
    labels: labels,
    datasets: [{
      label: '總資產走勢 (TWD)',
      backgroundColor: 'rgba(0, 122, 255, 0.1)',
      borderColor: '#007aff',
      borderWidth: 2,
      data: dataValues,
      fill: true,
      tension: 0.2
    }]
  }

  updateBarChartData()
  isCalculating.value = false
}

// 更新長條圖數據
const updateBarChartData = () => {
  const targetList = barMarketTab.value === 'TW' ? taiwanPortfolioRaw.value : usPortfolioRaw.value
  const sorted = [...targetList].sort((a, b) => b.marketValue - a.marketValue)

  let chartLabels = []
  let chartValues = []

  if (sorted.length <= 5) {
    chartLabels = sorted.map(item => item.name.length > 8 ? item.name.substring(0, 8) + '...' : item.name)
    chartValues = sorted.map(item => barMarketTab.value === 'US' ? item.marketValue * exchangeRate.value : item.marketValue)
  } else {
    const top5 = sorted.slice(0, 5)
    chartLabels = top5.map(item => item.name.length > 8 ? item.name.substring(0, 8) + '...' : item.name)
    chartValues = top5.map(item => barMarketTab.value === 'US' ? item.marketValue * exchangeRate.value : item.marketValue)

    const othersSum = sorted.slice(5).reduce((acc, cur) => {
      const val = barMarketTab.value === 'US' ? cur.marketValue * exchangeRate.value : cur.marketValue
      return acc + val
    }, 0)

    chartLabels.push('Others')
    chartValues.push(othersSum)
  }

  barChartData.value = {
    labels: chartLabels,
    datasets: [{
      label: '市值',
      backgroundColor: '#3b82f6',
      data: chartValues,
      borderRadius: 4
    }]
  }
}

// --- 資料庫讀寫 ---
const loadTransactions = async () => {
  const savedData = await localforage.getItem(DB_KEY)
  if (savedData) transactions.value = savedData
  const savedTargets = await localforage.getItem(TARGET_DB_KEY)
  if (savedTargets) stockTargets.value = savedTargets
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

const openTargetModal = (ticker) => {
  targetFormTicker.value = ticker
  const existing = stockTargets.value[ticker] || {}
  targetFormVal.value = {
    targetPrice: existing.targetPrice || '',
    stopPrice: existing.stopPrice || ''
  }
  showTargetModal.value = true
}

const saveTargetSetting = async () => {
  stockTargets.value[targetFormTicker.value] = {
    targetPrice: targetFormVal.value.targetPrice !== '' ? Number(targetFormVal.value.targetPrice) : null,
    stopPrice: targetFormVal.value.stopPrice !== '' ? Number(targetFormVal.value.stopPrice) : null
  }
  await localforage.setItem(TARGET_DB_KEY, JSON.parse(JSON.stringify(stockTargets.value)))
  showTargetModal.value = false
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

      <!-- 股利收入統計專區 -->
      <div class="dividend-summary-box">
        <p><strong>總累積現金股利：</strong> <span class="div-highlight">${{ totalDividendCashTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span></p>
        <div class="yearly-div-list" v-if="Object.keys(yearlyDividendSummary).length > 0">
          <small v-for="(val, yr) in yearlyDividendSummary" :key="yr" class="yearly-tag">
            {{ yr }}年: ${{ val.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}
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

    <!-- 圖表區塊 -->
    <section class="chart-section">
      <div class="chart-header-row">
        <div class="chart-type-selector">
          <button :class="['type-btn', chartType === 'line' ? 'active-type' : '']" @click="chartType = 'line'">資產折線圖</button>
          <button :class="['type-btn', chartType === 'bar' ? 'active-type' : '']" @click="chartType = 'bar'">個股市值長條圖</button>
        </div>
        <button @click="isChartOpen = !isChartOpen" class="toggle-chart-btn">
          {{ isChartOpen ? '收起 🔼' : '展開 🔽' }}
        </button>
      </div>

      <div v-if="chartType === 'bar' && isChartOpen" class="bar-market-selector">
        <button :class="['bar-sub-btn', barMarketTab === 'TW' ? 'active-sub' : '']" @click="barMarketTab = 'TW'; updateBarChartData()">台股前五大</button>
        <button :class="['bar-sub-btn', barMarketTab === 'US' ? 'active-sub' : '']" @click="barMarketTab = 'US'; updateBarChartData()">美股前五大</button>
      </div>

      <div class="chart-container" v-show="isChartOpen">
        <Line v-if="chartType === 'line'" :data="lineChartData" :options="lineChartOptions" />
        <Bar v-else :data="barChartData" :options="barChartOptions" />
      </div>
    </section>

    <!-- 市場切換標籤 -->
    <div class="tab-container">
      <button :class="['tab-btn', currentTab === 'TW' ? 'active' : '']" @click="currentTab = 'TW'">台股市場</button>
      <button :class="['tab-btn', currentTab === 'US' ? 'active' : '']" @click="currentTab = 'US'">美股市場</button>
    </div>

    <!-- 控制列 -->
    <div class="control-bar">
      <div class="sort-group">
        <span>排序：</span>
        <select v-model="sortOption" class="sort-select">
          <option value="value">依資產市值</option>
          <option value="ticker">依股票代號</option>
          <option value="shares">依持股股數</option>
        </select>
      </div>
      <div class="view-mode-group">
        <span>顯示：</span>
        <button :class="['mode-btn', viewMode === 'card' ? 'active-mode' : '']" @click="viewMode = 'card'">卡片</button>
        <button :class="['mode-btn', viewMode === 'list' ? 'active-mode' : '']" @click="viewMode = 'list'">列表</button>
      </div>
    </div>

    <main>
      <!-- 台股市場區塊 -->
      <section v-if="currentTab === 'TW'" class="portfolio">
        <h3>台股持股庫存</h3>
        <p v-if="taiwanPortfolio.length === 0" class="empty-msg">目前無台股庫存。</p>
        
        <div v-else-if="viewMode === 'card'" class="card-grid">
          <div v-for="stock in taiwanPortfolio" :key="stock.ticker" class="stock-card">
            <div class="card-header" @click="selectedTickerModal = stock.ticker">
              <div>
                <strong class="stock-name">{{ stock.name }}</strong> 
                <span class="stock-ticker">({{ stock.ticker }})</span>
              </div>
              <span>{{ stock.shares.toLocaleString() }} 股</span>
            </div>
            <div class="card-body" @click="selectedTickerModal = stock.ticker">
              <p>現價：${{ stock.currentPrice.toFixed(2) }} TWD</p>
              <p>市值：${{ stock.marketValue.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} TWD</p>
              <p>成本均價：${{ stock.avgCost.toFixed(2) }} TWD</p>
              <p :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                未實現損益：${{ stock.unrealizedPnL.toFixed(2) }} ({{ stock.pnlPercent.toFixed(2) }}%)
              </p>
              <!-- 目標價與停損警戒線提示 -->
              <div v-if="stock.targetPrice || stock.stopPrice" class="target-alert-box">
                <span v-if="stock.targetPrice && stock.currentPrice >= stock.targetPrice" class="alert-badge target-hit">🎯 已達目標價 ${{ stock.targetPrice }}</span>
                <span v-if="stock.stopPrice && stock.currentPrice <= stock.stopPrice" class="alert-badge stop-hit">⚠️ 跌破停損線 ${{ stock.stopPrice }}</span>
              </div>
            </div>
            <div class="card-footer-action">
              <button @click="openTargetModal(stock.ticker)" class="target-setting-btn">設定目標/警戒價</button>
            </div>
          </div>
        </div>

        <div v-else class="table-container">
          <table class="stock-table">
            <thead>
              <tr>
                <th>標的</th>
                <th>股數</th>
                <th>現價 / 市值</th>
                <th>均價</th>
                <th>未實現損益</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="stock in taiwanPortfolio" :key="stock.ticker">
                <td @click="selectedTickerModal = stock.ticker">
                  <strong>{{ stock.name }}</strong><br><small>{{ stock.ticker }}</small>
                  <div v-if="(stock.targetPrice && stock.currentPrice >= stock.targetPrice) || (stock.stopPrice && stock.currentPrice <= stock.stopPrice)">
                    <small :class="stock.currentPrice >= stock.targetPrice ? 'profit' : 'loss'">【觸及目標/警戒】</small>
                  </div>
                </td>
                <td @click="selectedTickerModal = stock.ticker">{{ stock.shares.toLocaleString() }}</td>
                <td @click="selectedTickerModal = stock.ticker">
                  ${{ stock.currentPrice.toFixed(2) }}<br><small style="color: #666;">市:${{ stock.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</small>
                </td>
                <td @click="selectedTickerModal = stock.ticker">${{ stock.avgCost.toFixed(2) }}</td>
                <td @click="selectedTickerModal = stock.ticker" :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
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
          <div v-for="stock in usPortfolio" :key="stock.ticker" class="stock-card">
            <div class="card-header" @click="selectedTickerModal = stock.ticker">
              <div>
                <strong class="stock-name">{{ stock.name }}</strong> 
                <span class="stock-ticker">({{ stock.ticker }})</span>
              </div>
              <span>{{ stock.shares.toLocaleString() }} 股</span>
            </div>
            <div class="card-body" @click="selectedTickerModal = stock.ticker">
              <p>現價：${{ stock.currentPrice.toFixed(2) }} USD</p>
              <p>市值：${{ stock.marketValue.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} USD</p>
              <p>成本均價：${{ stock.avgCost.toFixed(2) }} USD</p>
              <p :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                未實現損益：${{ stock.unrealizedPnL.toFixed(2) }} USD ({{ stock.pnlPercent.toFixed(2) }}%)
              </p>
              <div v-if="stock.targetPrice || stock.stopPrice" class="target-alert-box">
                <span v-if="stock.targetPrice && stock.currentPrice >= stock.targetPrice" class="alert-badge target-hit">🎯 已達目標價 ${{ stock.targetPrice }}</span>
                <span v-if="stock.stopPrice && stock.currentPrice <= stock.stopPrice" class="alert-badge stop-hit">⚠️ 跌破停損線 ${{ stock.stopPrice }}</span>
              </div>
            </div>
            <div class="card-footer-action">
              <button @click="openTargetModal(stock.ticker)" class="target-setting-btn">設定目標/警戒價</button>
            </div>
          </div>
        </div>

        <div v-else class="table-container">
          <table class="stock-table">
            <thead>
              <tr>
                <th>標的</th>
                <th>股數</th>
                <th>現價 / 市值</th>
                <th>均價</th>
                <th>未實現損益</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="stock in usPortfolio" :key="stock.ticker">
                <td @click="selectedTickerModal = stock.ticker">
                  <strong>{{ stock.name }}</strong><br><small>{{ stock.ticker }}</small>
                </td>
                <td @click="selectedTickerModal = stock.ticker">{{ stock.shares.toLocaleString() }}</td>
                <td @click="selectedTickerModal = stock.ticker">
                  ${{ stock.currentPrice.toFixed(2) }}<br><small style="color: #666;">市:${{ stock.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</small>
                </td>
                <td @click="selectedTickerModal = stock.ticker">${{ stock.avgCost.toFixed(2) }}</td>
                <td @click="selectedTickerModal = stock.ticker" :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
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
          <div class="form-group"><label>代號 (台股請自帶 .TW 或 .TWO)</label><input v-model="formData.ticker" type="text" required placeholder="如 2330.TW 或 3293.TWO"></div>
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

    <!-- 設定目標價與停損線彈窗 -->
    <div v-if="showTargetModal" class="modal-overlay" @click.self="showTargetModal = false">
      <div class="modal-content">
        <h3>設定 {{ targetFormTicker }} 價格提示</h3>
        <form @submit.prevent="saveTargetSetting">
          <div class="form-group"><label>目標價 (達標提示)</label><input v-model="targetFormVal.targetPrice" type="number" step="any" placeholder="例如 1000"></div>
          <div class="form-group"><label>停損 / 成本警戒線 (跌破警告)</label><input v-model="targetFormVal.stopPrice" type="number" step="any" placeholder="例如 500"></div>
          <div class="form-actions">
            <button type="button" @click="showTargetModal = false" class="cancel-btn">取消</button>
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

/* 股利統計區塊樣式 */
.dividend-summary-box { background: #fff; padding: 8px 12px; border-radius: 8px; margin: 8px 0; font-size: 0.9em; box-shadow: 0 1px 3px rgba(0,0,0,0.05); text-align: left; }
.div-highlight { color: #0284c7; font-weight: bold; }
.yearly-div-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.yearly-tag { background: #f0f9ff; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; border: 1px solid #bae6fd; }

.realized-pnl-box { margin: 8px 0; font-size: 1em; color: #333; background: #fff; padding: 6px 12px; border-radius: 6px; display: inline-block; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }

.chart-section { background: white; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid #e0e0e0; }
.chart-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.chart-type-selector { display: flex; background: #e5e5ea; border-radius: 6px; padding: 2px; }
.type-btn { background: transparent; border: none; padding: 6px 12px; font-size: 0.85em; font-weight: bold; color: #666; cursor: pointer; border-radius: 4px; }
.type-btn.active-type { background: white; color: #007aff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

.bar-market-selector { display: flex; margin-bottom: 10px; background: #f1f5f9; padding: 4px; border-radius: 6px; }
.bar-sub-btn { flex: 1; background: transparent; border: none; padding: 6px; font-size: 0.85em; font-weight: bold; color: #64748b; cursor: pointer; border-radius: 4px; }
.bar-sub-btn.active-sub { background: #3b82f6; color: white; }

.toggle-chart-btn { background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em; font-weight: bold; }
.toggle-chart-btn:hover { background: #e2e8f0; }
.chart-container { position: relative; height: 240px; width: 100%; margin-top: 10px; }

.tab-container { display: flex; margin-bottom: 10px; background: #e5e5ea; border-radius: 8px; padding: 4px; }
.tab-btn { flex: 1; padding: 10px; border: none; background: transparent; font-size: 16px; font-weight: bold; color: #666; cursor: pointer; border-radius: 6px; transition: 0.2s; }
.tab-btn.active { background: white; color: #007aff; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }

.control-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 0.9em; color: #555; background: #fff; padding: 8px 12px; border-radius: 8px; border: 1px solid #e0e0e0; }
.sort-group { display: flex; align-items: center; }
.sort-select { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font-size: 0.9em; color: #333; }
.view-mode-group { display: flex; align-items: center; }
.mode-btn { margin-left: 6px; padding: 4px 10px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; font-size: 0.85em; }
.mode-btn.active-mode { background: #007aff; color: white; border-color: #007aff; }

.card-grid { display: grid; grid-template-columns: 1fr; gap: 15px; margin-bottom: 20px; }
.stock-card { background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); transition: transform 0.1s; }
.card-header { display: flex; justify-content: space-between; align-items: baseline; font-size: 1.1em; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 10px; cursor: pointer; }
.stock-name { font-size: 1.1em; color: #111; margin-right: 6px; }
.stock-ticker { font-size: 0.85em; color: #666; }
.card-body { cursor: pointer; }
.card-body p { margin: 5px 0; font-size: 0.95em; color: #555; }

/* 目標價/警戒線提示標籤 */
.target-alert-box { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
.alert-badge { font-size: 0.8em; padding: 2px 8px; border-radius: 4px; font-weight: bold; }
.target-hit { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.stop-hit { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }

.card-footer-action { margin-top: 10px; border-top: 1px dashed #eee; padding-top: 8px; text-align: right; }
.target-setting-btn { background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.8em; }
.target-setting-btn:hover { background: #e2e8f0; }

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