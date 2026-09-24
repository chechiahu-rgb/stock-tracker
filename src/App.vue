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
const TARGET_DB_KEY = 'stock_targets'
const GB_DB_KEY = 'gold_bonds_records'
const DAILY_ASSET_DB_KEY = 'daily_asset_snapshots'
const FUNDS_DB_KEY = 'funds_records'

// --- 響應式變數 ---
const totalAssetsTWD = ref(0)
const taiwanAssetsTWD = ref(0)
const usAssetsTWD = ref(0)
const goldBondsAssetsTWD = ref(0)
const fundsAssetsTWD = ref(0)

const taiwanTotalCost = ref(0)
const taiwanUnrealizedPnL = ref(0)
const taiwanRealizedPnLTWD = ref(0)

const usTotalCost = ref(0)
const usUnrealizedPnL = ref(0)
const usRealizedPnLUSD = ref(0)

const goldBondsTotalCost = ref(0)
const goldBondsUnrealizedPnL = ref(0)

const fundsTotalCost = ref(0)
const fundsUnrealizedPnL = ref(0)
const fundsRealizedPnLTWD = ref(0) // 新增：基金已實現損益 (TWD)
const fundsTotalDividendTWD = ref(0) // 新增：基金累積配息 (TWD)

// 分市場股利統計
const taiwanTotalDividendTWD = ref(0)
const taiwanYearlyDividendSummary = ref({})
const usTotalDividendTWD = ref(0)
const usYearlyDividendSummary = ref({})

const exchangeRates = ref({
  TWD: 1,
  USD: 32.5,
  JPY: 0.21,
  AUD: 21.5,
  EUR: 35.0,
  KRW: 0.024
})

const transactions = ref([])
const goldBondsTransactions = ref([])
const goldBondsPortfolioRaw = ref([])

const fundsTransactions = ref([])
const fundsPortfolioRaw = ref([])

const taiwanPortfolioRaw = ref([])
const usPortfolioRaw = ref([])
const exchangeRate = ref(32.5) 
const goldPricePerGram = ref(4393)
const isCalculating = ref(false)

const currentTab = ref('overview') 
const viewMode = ref('card')
const sortOption = ref('value')

const stockTargets = ref({})

// 展開 / 收起 控制變數
const isChartOpen = ref(true)
const isTaiwanOpen = ref(true)
const isTaiwanClosedOpen = ref(true) // 新增：台股已結清區塊展開控制
const isTaiwanHistoryOpen = ref(false)

const isUsOpen = ref(true)
const isUsClosedOpen = ref(true) // 新增：美股已結清區塊展開控制
const isUsHistoryOpen = ref(false)

const isGBOpen = ref(true)
const isGBHistoryOpen = ref(false)

const isFundsOpen = ref(true)
const isFundsClosedOpen = ref(true) // 新增：基金已結清區塊展開控制
const isFundsHistoryOpen = ref(false)

const chartType = ref('line')
const barMarketTab = ref('TW')

const showForm = ref(false)
const showGBForm = ref(false)
const showFundForm = ref(false)
const showNavUpdateModal = ref(false)
const showTargetModal = ref(false)
const selectedTickerModal = ref(null)
const selectedGBNameModal = ref(null)
const selectedFundNameModal = ref(null)

const targetFormTicker = ref('')
const targetFormVal = ref({ targetPrice: '', stopPrice: '' })

// 手動更新淨值用
const navUpdateItemName = ref('')
const navUpdateVal = ref(null)

// 編輯交易狀態
const editingTxId = ref(null)
const editingGBTxId = ref(null)
const editingFundTxId = ref(null)

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

const gbFormData = ref({
  category: '黃金',
  name: '',
  date: new Date().toISOString().split('T')[0],
  type: '買進',
  amount: null,
  price: null,
  marketValue: null,
  fee: 0,
  currency: 'TWD',
  dividendCash: 0
})

const fundFormData = ref({
  name: '',
  code: '',
  date: new Date().toISOString().split('T')[0],
  type: '買進',
  units: null,
  price: null,
  currentNav: null,
  fee: 0,
  currency: 'TWD',
  dividendCash: 0
})

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

// 篩選已結清（股數為0，但有交易記錄）的台股標的
const taiwanClosedPortfolio = computed(() => {
  const allTickers = [...new Set(taiwanTransactions.value.map(tx => tx.ticker))]
  const closed = []

  allTickers.forEach(ticker => {
    const txs = taiwanTransactions.value.filter(t => t.ticker === ticker)
    let shares = 0
    let totalCost = 0
    let realizedPnL = 0
    let totalSellAmount = 0

    txs.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(tx => {
      if (tx.type === '買進') {
        shares += Number(tx.shares)
        totalCost += (Number(tx.price) * Number(tx.shares)) + (Number(tx.fee) || 0)
      } else if (tx.type === '賣出' && shares > 0) {
        const avgCost = totalCost / shares
        const sellShares = Number(tx.shares)
        const costOfSold = avgCost * sellShares
        const revenue = (Number(tx.price) * sellShares) - (Number(tx.fee) || 0)
        
        realizedPnL += (revenue - costOfSold)
        totalSellAmount += revenue
        
        shares -= sellShares
        totalCost -= costOfSold
        if (shares <= 0) { shares = 0; totalCost = 0; }
      } else if (tx.type === '配息') {
        if (tx.dividendShares) shares += Number(tx.dividendShares)
      }
    })

    if (shares === 0 && txs.length > 0) {
      closed.push({
        ticker,
        txCount: txs.length,
        totalSellAmount,
        realizedPnL
      })
    }
  })

  return closed
})

// 篩選已結清（股數為0，但有交易記錄）的美股標的
const usClosedPortfolio = computed(() => {
  const allTickers = [...new Set(usTransactions.value.map(tx => tx.ticker))]
  const closed = []

  allTickers.forEach(ticker => {
    const txs = usTransactions.value.filter(t => t.ticker === ticker)
    let shares = 0
    let totalCost = 0
    let realizedPnL = 0
    let totalSellAmount = 0

    txs.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(tx => {
      if (tx.type === '買進') {
        shares += Number(tx.shares)
        totalCost += (Number(tx.price) * Number(tx.shares)) + (Number(tx.fee) || 0)
      } else if (tx.type === '賣出' && shares > 0) {
        const avgCost = totalCost / shares
        const sellShares = Number(tx.shares)
        const costOfSold = avgCost * sellShares
        const revenue = (Number(tx.price) * sellShares) - (Number(tx.fee) || 0)
        
        realizedPnL += (revenue - costOfSold)
        totalSellAmount += revenue
        
        shares -= sellShares
        totalCost -= costOfSold
        if (shares <= 0) { shares = 0; totalCost = 0; }
      } else if (tx.type === '配息') {
        if (tx.dividendShares) shares += Number(tx.dividendShares)
      }
    })

    if (shares === 0 && txs.length > 0) {
      closed.push({
        ticker,
        txCount: txs.length,
        totalSellAmount,
        realizedPnL
      })
    }
  })

  return closed
})

// 篩選已結清（單位數為0，但有交易記錄）的基金標的
const fundsClosedPortfolio = computed(() => {
  const allNames = [...new Set(fundsTransactions.value.map(tx => tx.name))]
  const closed = []

  allNames.forEach(name => {
    const txs = fundsTransactions.value.filter(t => t.name === name)
    let units = 0
    let totalCost = 0
    let realizedPnL = 0
    let totalSellAmount = 0

    txs.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(tx => {
      const rate = exchangeRates.value[tx.currency] || 1
      if (tx.type === '買進') {
        units += Number(tx.units)
        totalCost += ((Number(tx.price) * Number(tx.units)) + (Number(tx.fee) || 0)) * rate
      } else if (tx.type === '賣出' && units > 0) {
        const avgCost = totalCost / units
        const sellUnits = Number(tx.units)
        const costOfSold = avgCost * sellUnits
        const revenue = ((Number(tx.price) * sellUnits) - (Number(tx.fee) || 0)) * rate
        
        realizedPnL += (revenue - costOfSold)
        totalSellAmount += revenue
        
        units -= sellUnits
        totalCost -= costOfSold
        if (units <= 0) { units = 0; totalCost = 0; }
      }
    })

    if (units === 0 && txs.length > 0) {
      closed.push({
        name,
        txCount: txs.length,
        totalSellAmount,
        realizedPnL
      })
    }
  })

  return closed
})

const taiwanTransactions = computed(() => {
  return transactions.value.filter(tx => !tx.currency || tx.currency === 'TWD')
})

const usTransactions = computed(() => {
  return transactions.value.filter(tx => tx.currency === 'USD')
})

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

// 自動爬蟲外幣匯率
const fetchExchangeRates = async () => {
  try {
    const usdtwd = await fetchStockData('TWD=X')
    if (usdtwd.price > 0) {
      exchangeRates.value.USD = usdtwd.price
      exchangeRate.value = usdtwd.price
    }

    const usdjpy = await fetchStockData('USDJPY=X')
    if (usdjpy.price > 0 && exchangeRates.value.USD) {
      exchangeRates.value.JPY = exchangeRates.value.USD / usdjpy.price
    }

    const audusd = await fetchStockData('AUDUSD=X')
    if (audusd.price > 0 && exchangeRates.value.USD) {
      exchangeRates.value.AUD = audusd.price * exchangeRates.value.USD
    }

    const eurusd = await fetchStockData('EURUSD=X')
    if (eurusd.price > 0 && exchangeRates.value.USD) {
      exchangeRates.value.EUR = eurusd.price * exchangeRates.value.USD
    }

    const usdkrw = await fetchStockData('USDKRW=X')
    if (usdkrw.price > 0 && exchangeRates.value.USD) {
      exchangeRates.value.KRW = exchangeRates.value.USD / usdkrw.price
    }
  } catch (err) {
    console.error('抓取即時匯率失敗，使用預設值', err)
  }
}

const fetchTaiwanBankGoldPrice = async () => {
  try {
    const goldRes = await axios.get('/yahoo/v8/finance/chart/GC=F?interval=1d&range=1d')
    const goldUSD_per_oz = goldRes.data.chart.result[0].meta.regularMarketPrice || 2600
    const usdPerGram = goldUSD_per_oz / 31.1035
    const priceTWD = usdPerGram * exchangeRate.value
    return Math.round(priceTWD) > 1000 ? Math.round(priceTWD) : 4393
  } catch (error) {
    return 4393
  }
}

// 每天晚上 21:00 自動刷新數據並重新繪圖的定時排程
const setupDailyAutoUpdate = () => {
  const now = new Date()
  const targetTime = new Date()
  targetTime.setHours(21, 0, 0, 0)

  if (now >= targetTime) {
    targetTime.setDate(targetTime.getDate() + 1)
  }

  const timeUntil21PM = targetTime.getTime() - now.getTime()

  setTimeout(() => {
    calculatePortfolio()
    setInterval(() => {
      calculatePortfolio()
    }, 24 * 60 * 60 * 1000)
  }, timeUntil21PM)
}

const calculatePortfolio = async () => {
  isCalculating.value = true
  await fetchExchangeRates()

  const summary = {}
  let realizedTWD = 0
  let realizedUSD = 0

  let twDivTotal = 0
  let twYearlyDivs = {}
  let usDivTotal = 0
  let usYearlyDivs = {}

  const sortedTx = [...transactions.value].sort((a, b) => new Date(a.date) - new Date(b.date))
  let runningSummary = {}

  // 1. 分別計算台股與美股的已實現損益與累積股利
  sortedTx.forEach(tx => {
    const year = tx.date ? tx.date.split('-')[0] : '未知年份'
    if (!runningSummary[tx.ticker]) {
      runningSummary[tx.ticker] = { shares: 0, totalCost: 0, currency: tx.currency }
    }
    const item = runningSummary[tx.ticker]

    if (tx.type === '買進') {
      item.shares += Number(tx.shares)
      item.totalCost += (Number(tx.price) * Number(tx.shares)) + Number(tx.fee || 0)
    } else if (tx.type === '賣出' && item.shares > 0) {
      const avgCostPerShare = item.totalCost / item.shares
      const sellShares = Number(tx.shares)
      const costOfSold = avgCostPerShare * sellShares
      const revenue = (Number(tx.price) * sellShares) - Number(tx.fee || 0)
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
        if (tx.currency === 'USD') {
          const cashInTWD = cashVal * exchangeRates.value.USD
          usDivTotal += cashInTWD
          if (!usYearlyDivs[year]) usYearlyDivs[year] = 0
          usYearlyDivs[year] += cashInTWD
        } else {
          twDivTotal += cashVal
          if (!twYearlyDivs[year]) twYearlyDivs[year] = 0
          twYearlyDivs[year] += cashVal
        }
      }
    }
  })

  taiwanRealizedPnLTWD.value = realizedTWD
  usRealizedPnLUSD.value = realizedUSD

  // 2. 統計股票當前持股庫存
  sortedTx.forEach(tx => {
    if (!summary[tx.ticker]) {
      summary[tx.ticker] = { ticker: tx.ticker, name: tx.ticker, shares: 0, totalCost: 0, currency: tx.currency }
    }
    const item = summary[tx.ticker]
    if (tx.type === '買進') {
      item.shares += Number(tx.shares)
      item.totalCost += (Number(tx.price) * Number(tx.shares)) + Number(tx.fee || 0)
    } else if (tx.type === '賣出' && item.shares > 0) {
      const avgCost = item.totalCost / item.shares
      item.shares -= Number(tx.shares)
      item.totalCost -= avgCost * Number(tx.shares)
      if (item.shares <= 0) { item.shares = 0; item.totalCost = 0; }
    } else if (tx.type === '配息') {
      if (tx.dividendShares) item.shares += Number(tx.dividendShares)
    }
  })

  goldPricePerGram.value = await fetchTaiwanBankGoldPrice()

  const gbSummary = {}
  const gbLatestMarketValue = {}

  goldBondsTransactions.value.forEach(tx => {
    if (!gbSummary[tx.name]) {
      gbSummary[tx.name] = { category: tx.category, name: tx.name, amount: 0, totalCost: 0, currency: tx.currency, totalDividend: 0 }
    }
    const item = gbSummary[tx.name]
    if (tx.type === '買進') {
      item.amount += Number(tx.amount)
      item.totalCost += (Number(tx.price) * Number(tx.amount)) + Number(tx.fee || 0)
      if (item.category === '債券' && tx.marketValue) {
        gbLatestMarketValue[tx.name] = Number(tx.marketValue)
      }
    } else if (tx.type === '賣出' && item.amount > 0) {
      const avgCost = item.totalCost / item.amount
      item.amount -= Number(tx.amount)
      item.totalCost -= avgCost * Number(tx.amount)
      if (item.category === '債券' && tx.marketValue) {
        gbLatestMarketValue[tx.name] = Number(tx.marketValue)
      }
    } else if (tx.type === '配息') {
      if (tx.dividendCash) {
        item.totalDividend += Number(tx.dividendCash)
        const divTWD = tx.currency === 'USD' ? Number(tx.dividendCash) * exchangeRates.value.USD : Number(tx.dividendCash)
        twDivTotal += divTWD
        const yr = tx.date.split('-')[0]
        if (!twYearlyDivs[yr]) twYearlyDivs[yr] = 0
        twYearlyDivs[yr] += divTWD
      }
      if (tx.marketValue) {
        gbLatestMarketValue[tx.name] = Number(tx.marketValue)
      }
    }
  })

  let gbTWD = 0
  let gbCostSum = 0
  let gbValueSum = 0
  const gbList = []

  for (const name in gbSummary) {
    const item = gbSummary[name]
    if (item.amount > 0 || item.category === '債券') {
      if (item.category === '黃金') {
        item.currentPrice = goldPricePerGram.value
        item.marketValue = item.amount * item.currentPrice
        item.avgCost = item.amount > 0 ? item.totalCost / item.amount : 0
        item.unrealizedPnL = item.marketValue - item.totalCost
        item.pnlPercent = item.totalCost > 0 ? (item.unrealizedPnL / item.totalCost) * 100 : 0
        item.currency = 'TWD'
        gbTWD += item.marketValue
        gbCostSum += item.totalCost
        gbValueSum += item.marketValue
      } else {
        const manualVal = gbLatestMarketValue[item.name] !== undefined ? gbLatestMarketValue[item.name] : item.totalCost
        item.marketValue = manualVal
        item.currentPrice = item.amount > 0 ? manualVal / item.amount : manualVal
        item.avgCost = item.amount > 0 ? item.totalCost / item.amount : 0

        const costTWD = item.currency === 'USD' ? item.totalCost * exchangeRates.value.USD : item.totalCost
        const valTWD = item.currency === 'USD' ? item.marketValue * exchangeRates.value.USD : item.marketValue
        item.unrealizedPnL = valTWD - costTWD
        item.pnlPercent = costTWD > 0 ? (item.unrealizedPnL / costTWD) * 100 : 0

        gbTWD += valTWD
        gbCostSum += costTWD
        gbValueSum += valTWD
      }
      gbList.push(item)
    }
  }

  goldBondsPortfolioRaw.value = gbList
  goldBondsAssetsTWD.value = gbTWD
  goldBondsTotalCost.value = gbCostSum
  goldBondsUnrealizedPnL.value = gbValueSum - gbCostSum

  // --- 基金庫存與已實現損益統計邏輯 ---
  const fundSummary = {}
  const fundLatestNAV = {}
  let fRealizedTWD = 0
  let fDividendTWD = 0

  const sortedFundsTx = [...fundsTransactions.value].sort((a, b) => new Date(a.date) - new Date(b.date))
  let runningFundSummary = {}

  sortedFundsTx.forEach(tx => {
    const rate = exchangeRates.value[tx.currency] || 1
    if (!runningFundSummary[tx.name]) {
      runningFundSummary[tx.name] = { units: 0, totalCostTWD: 0 }
    }
    const item = runningFundSummary[tx.name]

    if (tx.type === '買進') {
      item.units += Number(tx.units)
      item.totalCostTWD += ((Number(tx.price) * Number(tx.units)) + Number(tx.fee || 0)) * rate
    } else if (tx.type === '賣出' && item.units > 0) {
      const avgCostPerUnit = item.totalCostTWD / item.units
      const sellUnits = Number(tx.units)
      const costOfSold = avgCostPerUnit * sellUnits
      const revenue = ((Number(tx.price) * sellUnits) - Number(tx.fee || 0)) * rate
      const realizedPnL = revenue - costOfSold

      fRealizedTWD += realizedPnL

      item.units -= sellUnits
      item.totalCostTWD -= costOfSold
      if (item.units <= 0) { item.units = 0; item.totalCostTWD = 0; }
    } else if (tx.type === '配息') {
      if (tx.dividendCash) {
        fDividendTWD += Number(tx.dividendCash) * rate
      }
    }
  })

  fundsRealizedPnLTWD.value = fRealizedTWD
  fundsTotalDividendTWD.value = fDividendTWD

  fundsTransactions.value.forEach(tx => {
    if (!fundSummary[tx.name]) {
      fundSummary[tx.name] = { 
        name: tx.name, 
        code: tx.code || '', 
        units: 0, 
        totalCost: 0, 
        currency: tx.currency || 'TWD', 
        totalDividend: 0 
      }
    }
    const item = fundSummary[tx.name]
    if (tx.type === '買進') {
      item.units += Number(tx.units)
      item.totalCost += (Number(tx.price) * Number(tx.units)) + Number(tx.fee || 0)
      if (tx.currentNav) fundLatestNAV[tx.name] = Number(tx.currentNav)
    } else if (tx.type === '賣出' && item.units > 0) {
      const avgCost = item.totalCost / item.units
      const sellUnits = Number(tx.units)
      const costOfSold = avgCost * sellUnits
      item.units -= sellUnits
      item.totalCost -= costOfSold
      if (item.units <= 0) { item.units = 0; item.totalCost = 0; }
      if (tx.currentNav) fundLatestNAV[tx.name] = Number(tx.currentNav)
    } else if (tx.type === '配息') {
      if (tx.dividendCash) {
        item.totalDividend += Number(tx.dividendCash)
      }
      if (tx.currentNav) fundLatestNAV[tx.name] = Number(tx.currentNav)
    }
  })

  let fTWD = 0
  let fCostSum = 0
  let fValueSum = 0
  const fList = []

  for (const name in fundSummary) {
    const item = fundSummary[name]
    if (item.units > 0) {
      let nav = fundLatestNAV[name]

      if (item.code) {
        const yahooInfo = await fetchStockData(item.code)
        if (yahooInfo.price > 0) nav = yahooInfo.price
      }

      if (!nav || nav === 0) {
        nav = item.units > 0 ? (item.totalCost / item.units) : 0
      }

      item.currentNav = nav
      item.avgCost = item.units > 0 ? (item.totalCost / item.units) : 0
      item.marketValue = item.units * item.currentNav

      const rate = exchangeRates.value[item.currency] || 1
      const costTWD = item.totalCost * rate
      const valTWD = item.marketValue * rate

      item.unrealizedPnL = valTWD - costTWD
      item.pnlPercent = costTWD > 0 ? (item.unrealizedPnL / costTWD) * 100 : 0

      fTWD += valTWD
      fCostSum += costTWD
      fValueSum += valTWD

      fList.push(item)
    }
  }

  fundsPortfolioRaw.value = fList
  fundsAssetsTWD.value = fTWD
  fundsTotalCost.value = fCostSum
  fundsUnrealizedPnL.value = fValueSum - fCostSum

  taiwanTotalDividendTWD.value = twDivTotal
  taiwanYearlyDividendSummary.value = twYearlyDivs
  usTotalDividendTWD.value = usDivTotal
  usYearlyDividendSummary.value = usYearlyDivs

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

      const tSetting = stockTargets.value[ticker] || {}
      item.targetPrice = tSetting.targetPrice ? Number(tSetting.targetPrice) : null
      item.stopPrice = tSetting.stopPrice ? Number(tSetting.stopPrice) : null

      if (item.currency === 'USD') {
        const marketValueTWD = item.marketValue * exchangeRates.value.USD
        const totalCostTWD = item.totalCost * exchangeRates.value.USD
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

  totalTWD = twTWD + usTWD + gbTWD + fTWD

  taiwanPortfolioRaw.value = twList
  usPortfolioRaw.value = usList
  taiwanAssetsTWD.value = twTWD
  usAssetsTWD.value = usTWD
  totalAssetsTWD.value = totalTWD

  taiwanTotalCost.value = twCostSum
  taiwanUnrealizedPnL.value = twValueSum - twCostSum
  usTotalCost.value = usCostSumTWD
  usUnrealizedPnL.value = usValueSumTWD - usCostSumTWD

  await recordAndRenderDailyAssetHistory(totalTWD)

  updateBarChartData()
  isCalculating.value = false
}

const recordAndRenderDailyAssetHistory = async (currentTotalTWD) => {
  const todayStr = new Date().toISOString().split('T')[0]
  let snapshots = (await localforage.getItem(DAILY_ASSET_DB_KEY)) || {}

  if (currentTotalTWD > 0) {
    snapshots[todayStr] = Math.round(currentTotalTWD)
    await localforage.setItem(DAILY_ASSET_DB_KEY, JSON.parse(JSON.stringify(snapshots)))
  }

  const sortedDates = Object.keys(snapshots).sort((a, b) => new Date(a) - new Date(b))
  const chartValues = sortedDates.map(date => snapshots[date])

  lineChartData.value = {
    labels: sortedDates,
    datasets: [{
      label: '總資產市值走勢 (TWD)',
      backgroundColor: 'rgba(0, 122, 255, 0.1)',
      borderColor: '#007aff',
      borderWidth: 2,
      data: chartValues,
      fill: true,
      tension: 0.2
    }]
  }
}

const updateBarChartData = () => {
  const targetList = barMarketTab.value === 'TW' ? taiwanPortfolioRaw.value : usPortfolioRaw.value
  const sorted = [...targetList].sort((a, b) => b.marketValue - a.marketValue)

  let chartLabels = []
  let chartValues = []

  if (sorted.length <= 5) {
    chartLabels = sorted.map(item => item.name.length > 8 ? item.name.substring(0, 8) + '...' : item.name)
    chartValues = sorted.map(item => barMarketTab.value === 'US' ? item.marketValue * exchangeRates.value.USD : item.marketValue)
  } else {
    const top5 = sorted.slice(0, 5)
    chartLabels = top5.map(item => item.name.length > 8 ? item.name.substring(0, 8) + '...' : item.name)
    chartValues = top5.map(item => barMarketTab.value === 'US' ? item.marketValue * exchangeRates.value.USD : item.marketValue)

    const othersSum = sorted.slice(5).reduce((acc, cur) => {
      const val = barMarketTab.value === 'US' ? cur.marketValue * exchangeRates.value.USD : cur.marketValue
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

const loadTransactions = async () => {
  const savedData = await localforage.getItem(DB_KEY)
  if (savedData) transactions.value = savedData
  const savedGB = await localforage.getItem(GB_DB_KEY)
  if (savedGB) goldBondsTransactions.value = savedGB
  const savedFunds = await localforage.getItem(FUNDS_DB_KEY)
  if (savedFunds) fundsTransactions.value = savedFunds
  const savedTargets = await localforage.getItem(TARGET_DB_KEY)
  if (savedTargets) stockTargets.value = savedTargets
  await calculatePortfolio()
}

const saveTransaction = async () => {
  let inputTicker = formData.value.ticker.toUpperCase().trim()
  if (editingTxId.value) {
    const index = transactions.value.findIndex(tx => tx.id === editingTxId.value)
    if (index !== -1) {
      transactions.value[index] = {
        ...transactions.value[index],
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
    }
    editingTxId.value = null
  } else {
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
  }

  await localforage.setItem(DB_KEY, JSON.parse(JSON.stringify(transactions.value)))
  showForm.value = false
  resetForm()
  await calculatePortfolio()
}

const editTransaction = (tx) => {
  editingTxId.value = tx.id
  formData.value = {
    ticker: tx.ticker,
    date: tx.date,
    type: tx.type,
    shares: tx.shares,
    price: tx.price,
    fee: tx.fee,
    currency: tx.currency || 'TWD',
    dividendShares: tx.dividendShares || 0,
    dividendCash: tx.dividendCash || 0
  }
  selectedTickerModal.value = null
  showForm.value = true
}

const saveGBTransaction = async () => {
  if (editingGBTxId.value) {
    const index = goldBondsTransactions.value.findIndex(tx => tx.id === editingGBTxId.value)
    if (index !== -1) {
      goldBondsTransactions.value[index] = {
        ...goldBondsTransactions.value[index],
        category: gbFormData.value.category,
        name: gbFormData.value.name.trim(),
        date: gbFormData.value.date,
        type: gbFormData.value.type,
        amount: Number(gbFormData.value.amount) || 0,
        price: Number(gbFormData.value.price) || 0,
        marketValue: gbFormData.value.category === '債券' ? Number(gbFormData.value.marketValue) || 0 : 0,
        fee: Number(gbFormData.value.fee) || 0,
        currency: gbFormData.value.currency,
        dividendCash: Number(gbFormData.value.dividendCash) || 0
      }
    }
    editingGBTxId.value = null
  } else {
    const newTx = {
      id: crypto.randomUUID(),
      category: gbFormData.value.category,
      name: gbFormData.value.name.trim(),
      date: gbFormData.value.date,
      type: gbFormData.value.type,
      amount: Number(gbFormData.value.amount) || 0,
      price: Number(gbFormData.value.price) || 0,
      marketValue: gbFormData.value.category === '債券' ? Number(gbFormData.value.marketValue) || 0 : 0,
      fee: Number(gbFormData.value.fee) || 0,
      currency: gbFormData.value.currency,
      dividendCash: Number(gbFormData.value.dividendCash) || 0
    }
    goldBondsTransactions.value.push(newTx)
  }

  await localforage.setItem(GB_DB_KEY, JSON.parse(JSON.stringify(goldBondsTransactions.value)))
  showGBForm.value = false
  resetGBForm()
  await calculatePortfolio()
}

const saveFundTransaction = async () => {
  if (editingFundTxId.value) {
    const index = fundsTransactions.value.findIndex(tx => tx.id === editingFundTxId.value)
    if (index !== -1) {
      fundsTransactions.value[index] = {
        ...fundsTransactions.value[index],
        name: fundFormData.value.name.trim(),
        code: fundFormData.value.code.trim(),
        date: fundFormData.value.date,
        type: fundFormData.value.type,
        units: Number(fundFormData.value.units) || 0,
        price: Number(fundFormData.value.price) || 0,
        currentNav: Number(fundFormData.value.currentNav) || 0,
        fee: Number(fundFormData.value.fee) || 0,
        currency: fundFormData.value.currency,
        dividendCash: Number(fundFormData.value.dividendCash) || 0
      }
    }
    editingFundTxId.value = null
  } else {
    const newTx = {
      id: crypto.randomUUID(),
      name: fundFormData.value.name.trim(),
      code: fundFormData.value.code.trim(),
      date: fundFormData.value.date,
      type: fundFormData.value.type,
      units: Number(fundFormData.value.units) || 0,
      price: Number(fundFormData.value.price) || 0,
      currentNav: Number(fundFormData.value.currentNav) || 0,
      fee: Number(fundFormData.value.fee) || 0,
      currency: fundFormData.value.currency,
      dividendCash: Number(fundFormData.value.dividendCash) || 0
    }
    fundsTransactions.value.push(newTx)
  }

  await localforage.setItem(FUNDS_DB_KEY, JSON.parse(JSON.stringify(fundsTransactions.value)))
  showFundForm.value = false
  resetFundForm()
  await calculatePortfolio()
}

const saveUpdatedNAV = async () => {
  if (!navUpdateItemName.value || !navUpdateVal.value) return

  const newTx = {
    id: crypto.randomUUID(),
    name: navUpdateItemName.value,
    code: '',
    date: new Date().toISOString().split('T')[0],
    type: '配息',
    units: 0,
    price: 0,
    currentNav: Number(navUpdateVal.value),
    fee: 0,
    currency: 'TWD',
    dividendCash: 0
  }
  fundsTransactions.value.push(newTx)

  await localforage.setItem(FUNDS_DB_KEY, JSON.parse(JSON.stringify(fundsTransactions.value)))
  showNavUpdateModal.value = false
  navUpdateVal.value = null
  await calculatePortfolio()
}

const editGBTransaction = (tx) => {
  editingGBTxId.value = tx.id
  gbFormData.value = {
    category: tx.category,
    name: tx.name,
    date: tx.date,
    type: tx.type,
    amount: tx.amount,
    price: tx.price,
    marketValue: tx.marketValue || 0,
    fee: tx.fee || 0,
    currency: tx.currency || 'TWD',
    dividendCash: tx.dividendCash || 0
  }
  selectedGBNameModal.value = null
  showGBForm.value = true
}

const editFundTransaction = (tx) => {
  editingFundTxId.value = tx.id
  fundFormData.value = {
    name: tx.name,
    code: tx.code || '',
    date: tx.date,
    type: tx.type,
    units: tx.units,
    price: tx.price,
    currentNav: tx.currentNav || 0,
    fee: tx.fee || 0,
    currency: tx.currency || 'TWD',
    dividendCash: tx.dividendCash || 0
  }
  selectedFundNameModal.value = null
  showFundForm.value = true
}

const deleteGBTransaction = async (id) => {
  goldBondsTransactions.value = goldBondsTransactions.value.filter(tx => tx.id !== id)
  await localforage.setItem(GB_DB_KEY, JSON.parse(JSON.stringify(goldBondsTransactions.value)))
  await calculatePortfolio()
}

const deleteFundTransaction = async (id) => {
  fundsTransactions.value = fundsTransactions.value.filter(tx => tx.id !== id)
  await localforage.setItem(FUNDS_DB_KEY, JSON.parse(JSON.stringify(fundsTransactions.value)))
  await calculatePortfolio()
}

const deleteTransaction = async (id) => {
  transactions.value = transactions.value.filter(tx => tx.id !== id)
  await localforage.setItem(DB_KEY, JSON.parse(JSON.stringify(transactions.value)))
  await calculatePortfolio()
}

const exportBackup = async () => {
  const snapshots = (await localforage.getItem(DAILY_ASSET_DB_KEY)) || {}
  const backupData = {
    transactions: transactions.value,
    goldBondsTransactions: goldBondsTransactions.value,
    fundsTransactions: fundsTransactions.value,
    stockTargets: stockTargets.value,
    dailyAssetSnapshots: snapshots,
    exportDate: new Date().toISOString()
  }
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2))
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  
  const downloadAnchor = document.createElement('a')
  downloadAnchor.setAttribute("href", dataStr)
  downloadAnchor.setAttribute("download", `Stock-holdings_${yyyy}${mm}${dd}.json`)
  document.body.appendChild(downloadAnchor)
  downloadAnchor.click()
  downloadAnchor.remove()
}

const importBackup = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const content = JSON.parse(e.target.result)
      if (content.transactions && Array.isArray(content.transactions)) {
        transactions.value = content.transactions
        await localforage.setItem(DB_KEY, JSON.parse(JSON.stringify(transactions.value)))
      }
      if (content.goldBondsTransactions && Array.isArray(content.goldBondsTransactions)) {
        goldBondsTransactions.value = content.goldBondsTransactions
        await localforage.setItem(GB_DB_KEY, JSON.parse(JSON.stringify(goldBondsTransactions.value)))
      }
      if (content.fundsTransactions && Array.isArray(content.fundsTransactions)) {
        fundsTransactions.value = content.fundsTransactions
        await localforage.setItem(FUNDS_DB_KEY, JSON.parse(JSON.stringify(content.fundsTransactions)))
      }
      if (content.stockTargets) {
        stockTargets.value = content.stockTargets
        await localforage.setItem(TARGET_DB_KEY, JSON.parse(JSON.stringify(stockTargets.value)))
      }
      if (content.dailyAssetSnapshots) {
        await localforage.setItem(DAILY_ASSET_DB_KEY, JSON.parse(JSON.stringify(content.dailyAssetSnapshots)))
      }
      await calculatePortfolio()
      alert('資料還原成功！')
    } catch (err) {
      alert('檔案格式錯誤，還原失敗！')
      console.error(err)
    }
    event.target.value = ''
  }
  reader.readAsText(file)
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

const openNavUpdateModal = (name) => {
  navUpdateItemName.value = name
  navUpdateVal.value = null
  showNavUpdateModal.value = true
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
  editingTxId.value = null
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

const resetGBForm = () => {
  editingGBTxId.value = null
  gbFormData.value = {
    category: '黃金',
    name: '',
    date: new Date().toISOString().split('T')[0],
    type: '買進',
    amount: null,
    price: null,
    marketValue: null,
    fee: 0,
    currency: 'TWD',
    dividendCash: 0
  }
}

const resetFundForm = () => {
  editingFundTxId.value = null
  fundFormData.value = {
    name: '',
    code: '',
    date: new Date().toISOString().split('T')[0],
    type: '買進',
    units: null,
    price: null,
    currentNav: null,
    fee: 0,
    currency: 'TWD',
    dividendCash: 0
  }
}

const filteredTransactionsByTicker = computed(() => {
  if (!selectedTickerModal.value) return []
  return transactions.value.filter(tx => tx.ticker === selectedTickerModal.value)
})

const filteredGBTransactionsByName = computed(() => {
  if (!selectedGBNameModal.value) return []
  return goldBondsTransactions.value.filter(tx => tx.name === selectedGBNameModal.value)
})

const filteredFundTransactionsByName = computed(() => {
  if (!selectedFundNameModal.value) return []
  return fundsTransactions.value.filter(tx => tx.name === selectedFundNameModal.value)
})

onMounted(() => {
  loadTransactions()
  setupDailyAutoUpdate()
})
</script>

<template>
  <div class="app-container">
    <header>
      <h1>資產總覽</h1>
      <h2 v-if="!isCalculating">總市值：${{ totalAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</h2>
      <h2 v-else>結算中...</h2>

      <!-- 主導航目錄選單 -->
      <div class="nav-menu-grid" style="grid-template-columns: repeat(5, 1fr);">
        <button :class="['nav-btn', currentTab === 'overview' ? 'active-nav' : '']" @click="currentTab = 'overview'">🏠 總覽</button>
        <button :class="['nav-btn', currentTab === 'TW' ? 'active-nav' : '']" @click="currentTab = 'TW'">📈 台股</button>
        <button :class="['nav-btn', currentTab === 'US' ? 'active-nav' : '']" @click="currentTab = 'US'">📉 美股</button>
        <button :class="['nav-btn', currentTab === 'funds' ? 'active-nav' : '']" @click="currentTab = 'funds'">🌐 基金</button>
        <button :class="['nav-btn', currentTab === 'gold_bonds' ? 'active-nav' : '']" @click="currentTab = 'gold_bonds'">🥇 黃金/債券</button>
      </div>

      <!-- 快捷工具列 (備份還原) -->
      <div class="backup-toolbar" style="margin-top: 15px;">
        <button @click="exportBackup" class="backup-btn">📤 匯出備份</button>
        <label class="backup-btn import-btn">
          📥 匯入還原
          <input type="file" accept=".json" @change="importBackup" style="display: none;">
        </label>
      </div>
    </header>

    <!-- ========================================== -->
    <!-- 1. 總覽首頁內容 (overview) -->
    <!-- ========================================== -->
    <div v-if="currentTab === 'overview'">
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

      <div class="sub-assets-box" style="margin-top: 8px;">
        <div class="market-summary-item">
          <span>基金市值：${{ fundsAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span>
          <br>
          <small>未實現：
            <strong :class="fundsUnrealizedPnL >= 0 ? 'profit' : 'loss'">
              ${{ fundsUnrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD 
              ({{ fundsTotalCost > 0 ? ((fundsUnrealizedPnL / fundsTotalCost) * 100).toFixed(2) : 0 }}%)
            </strong>
          </small>
        </div>
        <div class="market-summary-item">
          <span>黃金/債券市值：${{ goldBondsAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span>
          <br>
          <small>未實現：
            <strong :class="goldBondsUnrealizedPnL >= 0 ? 'profit' : 'loss'">
              ${{ goldBondsUnrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD 
              ({{ goldBondsTotalCost > 0 ? ((goldBondsUnrealizedPnL / goldBondsTotalCost) * 100).toFixed(2) : 0 }}%)
            </strong>
          </small>
        </div>
      </div>

      <!-- 圖表區塊 -->
      <section class="chart-section" style="margin-top: 15px;">
        <div class="chart-header-row">
          <div class="chart-type-selector">
            <button :class="['type-btn', chartType === 'line' ? 'active-type' : '']" @click="chartType = 'line'">資產折線圖</button>
            <button :class="['type-btn', chartType === 'bar' ? 'active-type' : '']" @click="chartType = 'bar'">市值長條圖</button>
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
    </div>

    <!-- ========================================== -->
    <!-- 2. 台股子目錄 (TW) -->
    <!-- ========================================== -->
    <main v-if="currentTab === 'TW'">
      <div class="dividend-summary-box">
        <p><strong>台股總累積現金股利：</strong> <span class="div-highlight">${{ taiwanTotalDividendTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span></p>
        <p style="margin-top: 6px;"><strong>台股累積已實現損益：</strong> 
          <span :class="taiwanRealizedPnLTWD >= 0 ? 'profit' : 'loss'">
            ${{ taiwanRealizedPnLTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD
          </span>
        </p>
        <div class="yearly-div-list" v-if="Object.keys(taiwanYearlyDividendSummary).length > 0">
          <small v-for="(val, yr) in taiwanYearlyDividendSummary" :key="yr" class="yearly-tag">
            {{ yr }}年: ${{ val.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}
          </small>
        </div>
      </div>

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

      <section class="portfolio">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0;">台股持股庫存</h3>
          <button @click="isTaiwanOpen = !isTaiwanOpen" class="toggle-chart-btn">
            {{ isTaiwanOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>

        <div v-show="isTaiwanOpen">
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
                  </td>
                  <td @click="selectedTickerModal = stock.ticker">{{ stock.shares.toLocaleString() }}</td>
                  <td @click="selectedTickerModal = stock.ticker">
                    ${{ stock.currentPrice.toFixed(2) }}<br><small>市:${{ stock.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</small>
                  </td>
                  <td @click="selectedTickerModal = stock.ticker">${{ stock.avgCost.toFixed(2) }}</td>
                  <td @click="selectedTickerModal = stock.ticker" :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                    ${{ stock.unrealizedPnL.toFixed(0) }}<br>({{ stock.pnlPercent.toFixed(1) }}%)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 台股已結清股票區塊 (加入展開/收起功能) -->
      <section class="portfolio" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0; color: #64748b;">台股已結清股票 (已未持股)</h3>
          <button @click="isTaiwanClosedOpen = !isTaiwanClosedOpen" class="toggle-chart-btn">
            {{ isTaiwanClosedOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isTaiwanClosedOpen">
          <div class="table-container">
            <p v-if="taiwanClosedPortfolio.length === 0" class="empty-msg" style="padding: 15px;">目前無已結清台股。</p>
            <table v-else class="stock-table">
              <thead>
                <tr>
                  <th>標的</th>
                  <th>交易次數</th>
                  <th>總賣出金額 (TWD)</th>
                  <th>已實現損益 (TWD)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="stock in taiwanClosedPortfolio" :key="stock.ticker" @click="selectedTickerModal = stock.ticker">
                  <td><strong>{{ stock.ticker }}</strong></td>
                  <td>{{ stock.txCount }} 次</td>
                  <td>${{ stock.totalSellAmount.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</td>
                  <td :class="stock.realizedPnL >= 0 ? 'profit' : 'loss'">
                    ${{ stock.realizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 台股歷史交易紀錄 (可收合) -->
      <section class="history-dark-section" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 0;">
          <h3 style="margin: 0; border: none; padding: 0;">台股歷史交易紀錄</h3>
          <button @click="isTaiwanHistoryOpen = !isTaiwanHistoryOpen" class="toggle-chart-btn" style="background: #334155; border-color: #475569; color: #f8fafc;">
            {{ isTaiwanHistoryOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isTaiwanHistoryOpen" style="margin-top: 15px;">
          <p v-if="taiwanTransactions.length === 0" class="empty-dark-msg">目前無台股交易紀錄。</p>
          <ul v-else class="tx-dark-list">
            <li v-for="tx in taiwanTransactions.slice().reverse()" :key="tx.id" class="tx-dark-item">
              <div class="tx-info">
                <strong class="tx-ticker">{{ tx.ticker }}</strong>
                <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
                <br>
                <small class="tx-sub">{{ tx.date }} | 
                  <span v-if="tx.type !== '配息'">{{ tx.shares }} 股 @ ${{ tx.price }} TWD</span>
                  <span v-else>配股: {{ tx.dividendShares }}股 / 現金股利: ${{ tx.dividendCash }}</span>
                </small>
              </div>
              <div style="display: flex; gap: 6px;">
                <button @click="editTransaction(tx)" class="edit-dark-btn">修改</button>
                <button @click="deleteTransaction(tx.id)" class="delete-dark-btn">刪除</button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <!-- ========================================== -->
    <!-- 3. 美股子目錄 (US) -->
    <!-- ========================================== -->
    <main v-if="currentTab === 'US'">
      <div class="dividend-summary-box">
        <p><strong>美股總累積現金股利：</strong> <span class="div-highlight">${{ usTotalDividendTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span></p>
        <p style="margin-top: 6px;"><strong>美股累積已實現損益：</strong> 
          <span :class="usRealizedPnLUSD >= 0 ? 'profit' : 'loss'">
            ${{ usRealizedPnLUSD.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} USD
            <small style="color: #64748b; font-weight: normal;">(約 ${{ (usRealizedPnLUSD * exchangeRates.USD).toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD)</small>
          </span>
        </p>
        <div class="yearly-div-list" v-if="Object.keys(usYearlyDividendSummary).length > 0">
          <small v-for="(val, yr) in usYearlyDividendSummary" :key="yr" class="yearly-tag">
            {{ yr }}年: ${{ val.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}
          </small>
        </div>
      </div>

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

      <section class="portfolio">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0;">美股持股庫存</h3>
          <button @click="isUsOpen = !isUsOpen" class="toggle-chart-btn">
            {{ isUsOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>

        <div v-show="isUsOpen">
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
                    ${{ stock.currentPrice.toFixed(2) }}<br><small>市:${{ stock.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</small>
                  </td>
                  <td @click="selectedTickerModal = stock.ticker">${{ stock.avgCost.toFixed(2) }}</td>
                  <td @click="selectedTickerModal = stock.ticker" :class="stock.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                    ${{ stock.unrealizedPnL.toFixed(0) }}<br>({{ stock.pnlPercent.toFixed(1) }}%)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 美股已結清股票區塊 (加入展開/收起功能) -->
      <section class="portfolio" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0; color: #64748b;">美股已結清股票 (已未持股)</h3>
          <button @click="isUsClosedOpen = !isUsClosedOpen" class="toggle-chart-btn">
            {{ isUsClosedOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isUsClosedOpen">
          <div class="table-container">
            <p v-if="usClosedPortfolio.length === 0" class="empty-msg" style="padding: 15px;">目前無已結清美股。</p>
            <table v-else class="stock-table">
              <thead>
                <tr>
                  <th>標的</th>
                  <th>交易次數</th>
                  <th>總賣出金額 (USD)</th>
                  <th>已實現損益 (USD)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="stock in usClosedPortfolio" :key="stock.ticker" @click="selectedTickerModal = stock.ticker">
                  <td><strong>{{ stock.ticker }}</strong></td>
                  <td>{{ stock.txCount }} 次</td>
                  <td>${{ stock.totalSellAmount.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</td>
                  <td :class="stock.realizedPnL >= 0 ? 'profit' : 'loss'">
                    ${{ stock.realizedPnL.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 美股歷史交易紀錄 (可收合) -->
      <section class="history-dark-section" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 0;">
          <h3 style="margin: 0; border: none; padding: 0;">美股歷史交易紀錄</h3>
          <button @click="isUsHistoryOpen = !isUsHistoryOpen" class="toggle-chart-btn" style="background: #334155; border-color: #475569; color: #f8fafc;">
            {{ isUsHistoryOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isUsHistoryOpen" style="margin-top: 15px;">
          <p v-if="usTransactions.length === 0" class="empty-dark-msg">目前無美股交易紀錄。</p>
          <ul v-else class="tx-dark-list">
            <li v-for="tx in usTransactions.slice().reverse()" :key="tx.id" class="tx-dark-item">
              <div class="tx-info">
                <strong class="tx-ticker">{{ tx.ticker }}</strong>
                <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
                <br>
                <small class="tx-sub">{{ tx.date }} | 
                  <span v-if="tx.type !== '配息'">{{ tx.shares }} 股 @ ${{ tx.price }} USD</span>
                  <span v-else>現金股利: ${{ tx.dividendCash }} USD</span>
                </small>
              </div>
              <div style="display: flex; gap: 6px;">
                <button @click="editTransaction(tx)" class="edit-dark-btn">修改</button>
                <button @click="deleteTransaction(tx.id)" class="delete-dark-btn">刪除</button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <!-- ========================================== -->
    <!-- 4. 基金子目錄 (funds) - 含已實現損益與已結清區塊 -->
    <!-- ========================================== -->
    <main v-if="currentTab === 'funds'">
      <div class="dividend-summary-box">
        <p><strong>基金累積配息：</strong> <span class="div-highlight">${{ fundsTotalDividendTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span></p>
        <p style="margin-top: 6px;"><strong>基金累積已實現損益：</strong> 
          <span :class="fundsRealizedPnLTWD >= 0 ? 'profit' : 'loss'">
            ${{ fundsRealizedPnLTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD
          </span>
        </p>
      </div>

      <section class="portfolio">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0;">🌐 基金持倉庫存</h3>
          <button @click="isFundsOpen = !isFundsOpen" class="toggle-chart-btn">
            {{ isFundsOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>

        <div v-show="isFundsOpen">
          <p v-if="fundsPortfolioRaw.length === 0" class="empty-msg">目前無基金持倉。</p>
          
          <div v-else class="card-grid">
            <div v-for="item in fundsPortfolioRaw" :key="item.name" class="stock-card">
              <div class="card-header" @click="selectedFundNameModal = item.name">
                <div>
                  <strong class="stock-name">{{ item.name }}</strong> 
                  <span class="stock-ticker" v-if="item.code">({{ item.code }})</span>
                </div>
                <span>{{ item.units.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} 單位</span>
              </div>
              <div class="card-body" @click="selectedFundNameModal = item.name">
                <p>申購均價 vs 最新淨值：<strong>${{ item.avgCost.toFixed(2) }}</strong> / <strong style="color: #0284c7;">${{ item.currentNav.toFixed(2) }} {{ item.currency }}</strong></p>
                <p>當前總市值 (TWD)：<strong>${{ item.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</strong></p>
                <p v-if="item.totalDividend > 0">已領累積配息：${{ item.totalDividend.toLocaleString() }} {{ item.currency }}</p>
                <p :class="item.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                  未實現損益：${{ item.unrealizedPnL.toFixed(0) }} TWD ({{ item.pnlPercent.toFixed(2) }}%)
                </p>
              </div>
              <div class="card-footer-action">
                <button @click="openNavUpdateModal(item.name)" class="target-setting-btn">更新最新淨值 (NAV)</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 基金已結清區塊 (加入展開/收起功能) -->
      <section class="portfolio" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0; color: #64748b;">基金已結清 (已未持有)</h3>
          <button @click="isFundsClosedOpen = !isFundsClosedOpen" class="toggle-chart-btn">
            {{ isFundsClosedOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isFundsClosedOpen">
          <div class="table-container">
            <p v-if="fundsClosedPortfolio.length === 0" class="empty-msg" style="padding: 15px;">目前無已結清基金。</p>
            <table v-else class="stock-table">
              <thead>
                <tr>
                  <th>基金名稱</th>
                  <th>交易次數</th>
                  <th>總贖回金額 (TWD)</th>
                  <th>已實現損益 (TWD)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="fund in fundsClosedPortfolio" :key="fund.name" @click="selectedFundNameModal = fund.name">
                  <td><strong>{{ fund.name }}</strong></td>
                  <td>{{ fund.txCount }} 次</td>
                  <td>${{ fund.totalSellAmount.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}</td>
                  <td :class="fund.realizedPnL >= 0 ? 'profit' : 'loss'">
                    ${{ fund.realizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 基金歷史紀錄專區 (可收合) -->
      <section class="history-dark-section" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 0;">
          <h3 style="margin: 0; border: none; padding: 0;">基金歷史紀錄</h3>
          <button @click="isFundsHistoryOpen = !isFundsHistoryOpen" class="toggle-chart-btn" style="background: #334155; border-color: #475569; color: #f8fafc;">
            {{ isFundsHistoryOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isFundsHistoryOpen" style="margin-top: 15px;">
          <p v-if="fundsTransactions.length === 0" class="empty-dark-msg">目前無基金申購紀錄。</p>
          <ul v-else class="tx-dark-list">
            <li v-for="tx in fundsTransactions.slice().reverse()" :key="tx.id" class="tx-dark-item">
              <div class="tx-info">
                <strong class="tx-ticker">{{ tx.name }}</strong>
                <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
                <br>
                <small class="tx-sub">{{ tx.date }} | 
                  <span v-if="tx.type !== '配息'">{{ tx.units }} 單位 @ NAV ${{ tx.price }} {{ tx.currency }}</span>
                  <span v-else>配息: ${{ tx.dividendCash }} {{ tx.currency }} <span v-if="tx.currentNav">| 更新NAV: ${{ tx.currentNav }}</span></span>
                </small>
              </div>
              <div style="display: flex; gap: 6px;">
                <button @click="editFundTransaction(tx)" class="edit-dark-btn">修改</button>
                <button @click="deleteFundTransaction(tx.id)" class="delete-dark-btn">刪除</button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <!-- ========================================== -->
    <!-- 5. 黃金/債券子目錄 (gold_bonds) -->
    <!-- ========================================== -->
    <main v-if="currentTab === 'gold_bonds'">
      <section class="portfolio">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0;">黃金與債券持倉</h3>
          <button @click="isGBOpen = !isGBOpen" class="toggle-chart-btn">
            {{ isGBOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>

        <div v-show="isGBOpen">
          <p style="font-size: 0.85em; color: #64748b; margin-bottom: 10px;">
            黃金牌價：台銀每公克 ${{ goldPricePerGram.toLocaleString() }} TWD
          </p>
          <p v-if="goldBondsPortfolioRaw.length === 0" class="empty-msg">目前無黃金或債券持倉。</p>
          
          <div v-else class="card-grid">
            <div v-for="item in goldBondsPortfolioRaw" :key="item.name" class="stock-card">
              <div class="card-header" @click="selectedGBNameModal = item.name">
                <div>
                  <strong class="stock-name">{{ item.name }}</strong> 
                  <span class="stock-ticker">({{ item.category }})</span>
                </div>
                <span>{{ item.amount.toLocaleString() }} {{ item.category === '黃金' ? '克' : '單位' }}</span>
              </div>
              <div class="card-body" @click="selectedGBNameModal = item.name">
                <p>現價/市值：${{ item.marketValue.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} {{ item.category === '黃金' ? 'TWD' : item.currency }}</p>
                <p>成本均價：${{ item.avgCost.toFixed(2) }}</p>
                <p v-if="item.totalDividend > 0">已領配息：${{ item.totalDividend.toLocaleString() }}</p>
                <p :class="item.unrealizedPnL >= 0 ? 'profit' : 'loss'">
                  未實現損益：${{ item.unrealizedPnL.toFixed(2) }} TWD ({{ item.pnlPercent.toFixed(2) }}%)
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 黃金/債券歷史交易紀錄 (可收合) -->
      <section class="history-dark-section" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 0;">
          <h3 style="margin: 0; border: none; padding: 0;">黃金與債券歷史紀錄</h3>
          <button @click="isGBHistoryOpen = !isGBHistoryOpen" class="toggle-chart-btn" style="background: #334155; border-color: #475569; color: #f8fafc;">
            {{ isGBHistoryOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isGBHistoryOpen" style="margin-top: 15px;">
          <p v-if="goldBondsTransactions.length === 0" class="empty-dark-msg">目前無黃金/債券交易紀錄。</p>
          <ul v-else class="tx-dark-list">
            <li v-for="tx in goldBondsTransactions.slice().reverse()" :key="tx.id" class="tx-dark-item">
              <div class="tx-info">
                <strong class="tx-ticker">{{ tx.name }}</strong>
                <span class="tag-dark-div" style="margin-right: 6px;">{{ tx.category }}</span>
                <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
                <br>
                <small class="tx-sub">{{ tx.date }} | 
                  <span v-if="tx.type !== '配息'">{{ tx.amount }} {{ tx.category === '黃金' ? '克' : '單位' }} @ ${{ tx.price }} {{ tx.currency }} <span v-if="tx.category==='債券'">| 現價總值: ${{ tx.marketValue }}</span></span>
                  <span v-else>配息: ${{ tx.dividendCash }} {{ tx.currency }} <span v-if="tx.marketValue">| 更新現價: ${{ tx.marketValue }}</span></span>
                </small>
              </div>
              <div style="display: flex; gap: 6px;">
                <button @click="editGBTransaction(tx)" class="edit-dark-btn">修改</button>
                <button @click="deleteGBTransaction(tx.id)" class="delete-dark-btn">刪除</button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <!-- 浮動新增按鈕 -->
    <button 
      @click="currentTab === 'gold_bonds' ? showGBForm = true : currentTab === 'funds' ? showFundForm = true : showForm = true" 
      class="fab-button" 
      v-if="currentTab !== 'overview'">+
    </button>

    <!-- 新增股票交易彈窗 -->
    <div v-if="showForm" class="modal-overlay">
      <div class="modal-content">
        <h3>{{ editingTxId ? '修改紀錄' : '新增紀錄' }}</h3>
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
            <button type="button" @click="showForm = false; resetForm();" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">儲存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 新增/修改基金交易彈窗 -->
    <div v-if="showFundForm" class="modal-overlay">
      <div class="modal-content">
        <h3>{{ editingFundTxId ? '修改基金紀錄' : '新增基金申購紀錄' }}</h3>
        <form @submit.prevent="saveFundTransaction">
          <div class="form-group"><label>基金名稱</label><input v-model="fundFormData.name" type="text" required placeholder="如：安聯台灣大壩基金 / 第一金AI"></div>
          <div class="form-group"><label>代號 (選填，若有 Yahoo 報價代號可填寫)</label><input v-model="fundFormData.code" type="text" placeholder="如 0P00000XXX"></div>
          <div class="form-group"><label>日期</label><input v-model="fundFormData.date" type="date" required></div>
          <div class="form-group">
            <label>幣別</label>
            <select v-model="fundFormData.currency">
              <option value="TWD">台幣 (TWD)</option>
              <option value="USD">美金 (USD)</option>
            </select>
          </div>
          <div class="form-group">
            <label>交易類型</label>
            <select v-model="fundFormData.type">
              <option value="買進">買進 (申購)</option>
              <option value="賣出">賣出 (贖回)</option>
              <option value="配息">配息</option>
            </select>
          </div>

          <template v-if="fundFormData.type !== '配息'">
            <div class="form-group"><label>申購單位數</label><input v-model="fundFormData.units" type="number" step="any" required placeholder="輸入單位數"></div>
            <div class="form-group"><label>申購時單位淨值 (NAV)</label><input v-model="fundFormData.price" type="number" step="any" required placeholder="輸入單位淨值"></div>
            <div class="form-group"><label>當前最新單位淨值 (選填)</label><input v-model="fundFormData.currentNav" type="number" step="any" placeholder="若未填寫將預設與申購價相同"></div>
            <div class="form-group"><label>手續費</label><input v-model="fundFormData.fee" type="number" step="any" required placeholder="0"></div>
          </template>

          <template v-else>
            <div class="form-group"><label>本次獲得配息金額</label><input v-model="fundFormData.dividendCash" type="number" step="any" required placeholder="0"></div>
            <div class="form-group"><label>更新最新單位淨值 (選填)</label><input v-model="fundFormData.currentNav" type="number" step="any" placeholder="輸入當前最新 NAV"></div>
          </template>

          <div class="form-actions">
            <button type="button" @click="showFundForm = false; resetFundForm();" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">儲存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 手動更新基金最新淨值彈窗 -->
    <div v-if="showNavUpdateModal" class="modal-overlay" @click.self="showNavUpdateModal = false">
      <div class="modal-content">
        <h3>更新 {{ navUpdateItemName }} 最新淨值 (NAV)</h3>
        <form @submit.prevent="saveUpdatedNAV">
          <div class="form-group">
            <label>最新單位淨值 (NAV)</label>
            <input v-model="navUpdateVal" type="number" step="any" required placeholder="例如：125.4">
          </div>
          <div class="form-actions">
            <button type="button" @click="showNavUpdateModal = false" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">更新淨值</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 新增/修改黃金/債券交易彈窗 -->
    <div v-if="showGBForm" class="modal-overlay">
      <div class="modal-content">
        <h3>{{ editingGBTxId ? '修改黃金/債券紀錄' : '新增黃金/債券紀錄' }}</h3>
        <form @submit.prevent="saveGBTransaction">
          <div class="form-group">
            <label>資產分類</label>
            <select v-model="gbFormData.category">
              <option value="黃金">黃金</option>
              <option value="債券">債券</option>
            </select>
          </div>
          <div class="form-group"><label>名稱 / 代號</label><input v-model="gbFormData.name" type="text" required placeholder="如：實體黃金 / META 2054 債券"></div>
          <div class="form-group"><label>日期</label><input v-model="gbFormData.date" type="date" required></div>
          <div class="form-group">
            <label>幣別</label>
            <select v-model="gbFormData.currency">
              <option value="TWD">台幣 (TWD)</option>
              <option value="USD">美金 (USD)</option>
            </select>
          </div>
          <div class="form-group">
            <label>交易類型</label>
            <select v-model="gbFormData.type">
              <option value="買進">買進</option>
              <option value="賣出">賣出</option>
              <option value="配息">配息 (債券專用)</option>
            </select>
          </div>

          <template v-if="gbFormData.type !== '配息'">
            <div class="form-group"><label>{{ gbFormData.category === '黃金' ? '克數' : '單位/股數' }}</label><input v-model="gbFormData.amount" type="number" step="any" required></div>
            <div class="form-group"><label>成交單價</label><input v-model="gbFormData.price" type="number" step="any" required></div>
            <div class="form-group" v-if="gbFormData.category === '債券'">
              <label>當前現價總市值 (選填，更新總價)</label>
              <input v-model="gbFormData.marketValue" type="number" step="any" placeholder="例如輸入當前總市值">
            </div>
            <div class="form-group"><label>手續費</label><input v-model="gbFormData.fee" type="number" step="any" required></div>
          </template>

          <template v-else>
            <div class="form-group"><label>本次獲得配息金額</label><input v-model="gbFormData.dividendCash" type="number" step="any" required placeholder="0"></div>
            <div class="form-group" v-if="gbFormData.category === '債券'">
              <label>更新當前現價總市值 (選填)</label>
              <input v-model="gbFormData.marketValue" type="number" step="any" placeholder="更新目前總市值">
            </div>
          </template>

          <div class="form-actions">
            <button type="button" @click="showGBForm = false; resetGBForm();" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">儲存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 個股目標與警戒價設定彈窗 -->
    <div v-if="showTargetModal" class="modal-overlay" @click.self="showTargetModal = false">
      <div class="modal-content">
        <h3>設定 {{ targetFormTicker }} 目標/警戒價</h3>
        <form @submit.prevent="saveTargetSetting">
          <div class="form-group">
            <label>目標價</label>
            <input v-model="targetFormVal.targetPrice" type="number" step="any" placeholder="設定目標停利價">
          </div>
          <div class="form-group">
            <label>停損價</label>
            <input v-model="targetFormVal.stopPrice" type="number" step="any" placeholder="設定停損警戒價">
          </div>
          <div class="form-actions">
            <button type="button" @click="showTargetModal = false" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">儲存設定</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 個股歷史紀錄專屬彈窗 -->
    <div v-if="selectedTickerModal" class="modal-overlay" @click.self="selectedTickerModal = null">
      <div class="modal-content">
        <h3>{{ selectedTickerModal }} 歷史紀錄</h3>
        <p v-if="filteredTransactionsByTicker.length === 0" class="empty-dark-msg">無相關紀錄。</p>
        <ul v-else class="tx-dark-list" style="margin-top: 15px;">
          <li v-for="tx in filteredTransactionsByTicker.slice().reverse()" :key="tx.id" class="tx-dark-item">
            <div class="tx-info">
              <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
              <small class="tx-sub">{{ tx.date }} | 
                <span v-if="tx.type !== '配息'">{{ tx.shares }} 股 @ ${{ tx.price }}</span>
                <span v-else>配股: {{ tx.dividendShares }}股 / 現金: ${{ tx.dividendCash }}</span>
              </small>
            </div>
            <div style="display: flex; gap: 6px;">
              <button @click="editTransaction(tx)" class="edit-dark-btn">修改</button>
              <button @click="deleteTransaction(tx.id)" class="delete-dark-btn">刪除</button>
            </div>
          </li>
        </ul>
        <button @click="selectedTickerModal = null" class="submit-btn" style="width: 100%; margin-top: 20px;">關閉</button>
      </div>
    </div>

    <!-- 基金項目歷史紀錄專屬彈窗 -->
    <div v-if="selectedFundNameModal" class="modal-overlay" @click.self="selectedFundNameModal = null">
      <div class="modal-content">
        <h3>{{ selectedFundNameModal }} 歷史紀錄</h3>
        <p v-if="filteredFundTransactionsByName.length === 0" class="empty-dark-msg">無相關紀錄。</p>
        <ul v-else class="tx-dark-list" style="margin-top: 15px;">
          <li v-for="tx in filteredFundTransactionsByName.slice().reverse()" :key="tx.id" class="tx-dark-item">
            <div class="tx-info">
              <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
              <small class="tx-sub">{{ tx.date }} | 
                <span v-if="tx.type !== '配息'">{{ tx.units }} 單位 @ NAV ${{ tx.price }} {{ tx.currency }}</span>
                <span v-else>配息: ${{ tx.dividendCash }} {{ tx.currency }}</span>
              </small>
            </div>
            <div style="display: flex; gap: 6px;">
              <button @click="editFundTransaction(tx)" class="edit-dark-btn">修改</button>
              <button @click="deleteFundTransaction(tx.id)" class="delete-dark-btn">刪除</button>
            </div>
          </li>
        </ul>
        <button @click="selectedFundNameModal = null" class="submit-btn" style="width: 100%; margin-top: 20px;">關閉</button>
      </div>
    </div>

    <!-- 黃金/債券項目歷史紀錄專屬彈窗 -->
    <div v-if="selectedGBNameModal" class="modal-overlay" @click.self="selectedGBNameModal = null">
      <div class="modal-content">
        <h3>{{ selectedGBNameModal }} 歷史紀錄</h3>
        <p v-if="filteredGBTransactionsByName.length === 0" class="empty-dark-msg">無相關紀錄。</p>
        <ul v-else class="tx-dark-list" style="margin-top: 15px;">
          <li v-for="tx in filteredGBTransactionsByName.slice().reverse()" :key="tx.id" class="tx-dark-item">
            <div class="tx-info">
              <span :class="{'tag-dark-buy': tx.type==='買進', 'tag-dark-sell': tx.type==='賣出', 'tag-dark-div': tx.type==='配息'}">{{ tx.type }}</span>
              <small class="tx-sub">{{ tx.date }} | 
                <span v-if="tx.type !== '配息'">{{ tx.amount }} 單位 @ ${{ tx.price }}</span>
                <span v-else>配息: ${{ tx.dividendCash }}</span>
              </small>
            </div>
            <div style="display: flex; gap: 6px;">
              <button @click="editGBTransaction(tx)" class="edit-dark-btn">修改</button>
              <button @click="deleteGBTransaction(tx.id)" class="delete-dark-btn">刪除</button>
            </div>
          </li>
        </ul>
        <button @click="selectedGBNameModal = null" class="submit-btn" style="width: 100%; margin-top: 20px;">關閉</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container { font-family: sans-serif; padding: 16px; max-width: 600px; margin: 0 auto; padding-bottom: 80px; }
header { background-color: #f4f4f5; padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 15px; }

.nav-menu-grid { display: grid; gap: 6px; margin-top: 15px; }
.nav-btn { background: #fff; border: 1px solid #cbd5e1; color: #334155; padding: 10px 4px; border-radius: 8px; font-weight: bold; font-size: 0.9em; cursor: pointer; transition: 0.2s; }
.nav-btn.active-nav { background: #007aff; color: #fff; border-color: #007aff; box-shadow: 0 2px 6px rgba(0,122,255,0.3); }

.sub-assets-box { display: flex; justify-content: space-around; margin: 6px 0; font-size: 0.95em; color: #333; background: #fff; padding: 12px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.market-summary-item { text-align: center; flex: 1; border-right: 1px solid #eee; }
.market-summary-item:last-child { border-right: none; }

.dividend-summary-box { background: #fff; padding: 10px 14px; border-radius: 8px; margin-bottom: 15px; font-size: 0.9em; box-shadow: 0 1px 3px rgba(0,0,0,0.05); text-align: left; }
.div-highlight { color: #0284c7; font-weight: bold; }
.yearly-div-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.yearly-tag { background: #f0f9ff; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; border: 1px solid #bae6fd; }

.backup-toolbar { display: flex; gap: 10px; justify-content: center; }
.backup-btn { background: #f8fafc; border: 1px solid #cbd5e1; color: #334155; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: bold; text-align: center; display: inline-block; }
.backup-btn:hover { background: #f1f5f9; }
.import-btn { display: flex; align-items: center; justify-content: center; }

.chart-section { background: white; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid #e0e0e0; }
.chart-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.chart-type-selector { display: flex; background: #e5e5ea; border-radius: 6px; padding: 2px; }
.type-btn { background: transparent; border: none; padding: 6px 12px; font-size: 0.85em; font-weight: bold; color: #666; cursor: pointer; border-radius: 4px; }
.type-btn.active-type { background: white; color: #007aff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }

.bar-market-selector { display: flex; margin-bottom: 10px; background: #f1f5f9; padding: 4px; border-radius: 6px; }
.bar-sub-btn { flex: 1; background: transparent; border: none; padding: 6px; font-size: 0.85em; font-weight: bold; color: #64748b; cursor: pointer; border-radius: 4px; }
.bar-sub-btn.active-sub { background: #3b82f6; color: white; }

.toggle-chart-btn { background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em; font-weight: bold; }
.chart-container { position: relative; height: 240px; width: 100%; margin-top: 10px; }

.control-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 0.9em; color: #555; background: #fff; padding: 8px 12px; border-radius: 8px; border: 1px solid #e0e0e0; }
.sort-group { display: flex; align-items: center; }
.sort-select { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font-size: 0.9em; color: #333; }
.view-mode-group { display: flex; align-items: center; }
.mode-btn { margin-left: 6px; padding: 4px 10px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; font-size: 0.85em; }
.mode-btn.active-mode { background: #007aff; color: white; border-color: #007aff; }

.card-grid { display: grid; grid-template-columns: 1fr; gap: 15px; margin-bottom: 20px; }
.stock-card { background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
.card-header { display: flex; justify-content: space-between; align-items: baseline; font-size: 1.1em; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 10px; cursor: pointer; }
.stock-name { font-size: 1.1em; color: #111; margin-right: 6px; }
.stock-ticker { font-size: 0.85em; color: #666; }
.card-body p { margin: 5px 0; font-size: 0.95em; color: #555; cursor: pointer; }
.card-footer-action { margin-top: 10px; border-top: 1px dashed #eee; padding-top: 8px; text-align: right; }
.target-setting-btn { background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 0.8em; }

.table-container { background: white; border-radius: 12px; overflow: hidden; border: 1px solid #e0e0e0; margin-bottom: 20px; }
.stock-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9em; }
.stock-table th { background: #f8f9fa; padding: 10px; border-bottom: 1px solid #ddd; color: #333; }
.stock-table td { padding: 10px; border-bottom: 1px solid #eee; color: #444; cursor: pointer; }

.history-dark-section { background: #1e293b; color: #f8fafc; padding: 20px; border-radius: 12px; margin-top: 20px; }
.empty-dark-msg { color: #94a3b8; text-align: center; font-size: 0.9em; margin-top: 10px; }
.tx-dark-list { list-style: none; padding: 0; margin: 0; }
.tx-dark-item { display: flex; justify-content: space-between; align-items: center; background: #0f172a; border: 1px solid #334155; padding: 12px; margin-bottom: 8px; border-radius: 8px; }
.tx-ticker { color: #ffffff; font-size: 1.05em; }
.tx-sub { color: #94a3b8; }
.tag-dark-buy { background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; margin-left: 6px; }
.tag-dark-sell { background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; margin-left: 6px; }
.tag-dark-div { background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 0.75em; margin-left: 6px; }
.delete-dark-btn { background: #dc2626; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em; }
.edit-dark-btn { background: #0284c7; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 0.85em; }

.placeholder-section { background: white; padding: 30px; border-radius: 12px; text-align: center; border: 1px solid #e0e0e0; margin-top: 10px; }
.empty-msg { color: #64748b; font-size: 0.95em; }

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