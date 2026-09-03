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
const BANK_DB_KEY = 'bank_records'

// --- 響應式變數 ---
const totalAssetsTWD = ref(0)
const taiwanAssetsTWD = ref(0)
const usAssetsTWD = ref(0)
const goldBondsAssetsTWD = ref(0)
const bankAssetsTWD = ref(0)
const totalRealizedPnLTWD = ref(0)

const taiwanTotalCost = ref(0)
const taiwanUnrealizedPnL = ref(0)
const usTotalCost = ref(0)
const usUnrealizedPnL = ref(0)

const goldBondsTotalCost = ref(0)
const goldBondsUnrealizedPnL = ref(0)

// 分市場股利統計
const taiwanTotalDividendTWD = ref(0)
const taiwanYearlyDividendSummary = ref({})
const usTotalDividendTWD = ref(0)
const usYearlyDividendSummary = ref({})

// 銀行資產與匯率
const bankTransactions = ref([])
const bankPortfolioRaw = ref([])
const bankCurrenciesSummary = ref({})

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

const taiwanPortfolioRaw = ref([])
const usPortfolioRaw = ref([])
const exchangeRate = ref(32.5) // 保留原本供美股換算使用
const goldPricePerGram = ref(4393)
const isCalculating = ref(false)

const currentTab = ref('overview') 
const viewMode = ref('card')
const sortOption = ref('value')

const stockTargets = ref({})

const isChartOpen = ref(true)
const isTaiwanOpen = ref(true)
const isTaiwanHistoryOpen = ref(false)
const isUsOpen = ref(true)
const isUsHistoryOpen = ref(false)
const isGBOpen = ref(true)
const isGBHistoryOpen = ref(false)
const isBankOpen = ref(true)
const isBankHistoryOpen = ref(false)

const chartType = ref('line')
const barMarketTab = ref('TW')

const showForm = ref(false)
const showGBForm = ref(false)
const showBankForm = ref(false)
const showTargetModal = ref(false)
const selectedTickerModal = ref(null)
const targetFormTicker = ref('')
const targetFormVal = ref({ targetPrice: '', stopPrice: '' })

// 編輯交易狀態
const editingTxId = ref(null)

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

const bankFormData = ref({
  bankName: '',
  accountType: '活存',
  currency: 'TWD',
  balance: null,
  date: new Date().toISOString().split('T')[0]
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

    // 透過交叉匯率或 Yahoo Finance 抓取其他幣別相對於美元或台幣
    // JPY (USDJPY=X) -> JPY per USD => TWD per JPY = (TWD=X) / (USDJPY=X)
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

    let dayTotalCost = 0
    for (const t in runningSummary) {
      const st = runningSummary[t]
      if (st.shares > 0) {
        let val = st.totalCost
        if (st.currency === 'USD') val *= exchangeRates.value.USD
        dayTotalCost += val
      }
    }
    dailyAssetHistory[tx.date] = dayTotalCost
  })

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

  goldPricePerGram.value = await fetchTaiwanBankGoldPrice()

  // 處理黃金與債券
  const gbSummary = {}
  const gbLatestMarketValue = {}

  goldBondsTransactions.value.forEach(tx => {
    if (!gbSummary[tx.name]) {
      gbSummary[tx.name] = { category: tx.category, name: tx.name, amount: 0, totalCost: 0, currency: tx.currency, totalDividend: 0 }
    }
    const item = gbSummary[tx.name]
    if (tx.type === '買進') {
      item.amount += tx.amount
      item.totalCost += (tx.price * tx.amount) + tx.fee
      if (item.category === '債券' && tx.marketValue) {
        gbLatestMarketValue[tx.name] = Number(tx.marketValue)
      }
    } else if (tx.type === '賣出' && item.amount > 0) {
      const avgCost = item.totalCost / item.amount
      item.amount -= tx.amount
      item.totalCost -= avgCost * tx.amount
      if (item.category === '債券' && tx.marketValue) {
        gbLatestMarketValue[tx.name] = Number(tx.marketValue)
      }
    } else if (tx.type === '配息') {
      if (tx.dividendCash) {
        item.totalDividend += Number(tx.dividendCash)
        item.totalCost -= Number(tx.dividendCash)
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

  // 處理銀行帳戶資產
  const bankMap = {}
  const curSummary = {}

  bankTransactions.value.forEach(tx => {
    const key = `${tx.bankName}_${tx.accountType}_${tx.currency}`
    bankMap[key] = {
      bankName: tx.bankName,
      accountType: tx.accountType,
      currency: tx.currency,
      balance: Number(tx.balance) || 0,
      date: tx.date,
      id: tx.id
    }
  })

  let totalBankTWD = 0
  const bankList = []

  for (const k in bankMap) {
    const b = bankMap[k]
    const rate = exchangeRates.value[b.currency] || 1
    const valTWD = b.balance * rate
    b.marketValueTWD = valTWD
    totalBankTWD += valTWD

    if (!curSummary[b.currency]) curSummary[b.currency] = 0
    curSummary[b.currency] += b.balance

    bankList.push(b)
  }

  bankPortfolioRaw.value = bankList
  bankCurrenciesSummary.value = curSummary
  bankAssetsTWD.value = totalBankTWD

  totalRealizedPnLTWD.value = realizedTWD + (realizedUSD * exchangeRates.value.USD)
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

  totalTWD = twTWD + usTWD + gbTWD + totalBankTWD

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
  
  if (labels.includes(todayStr)) {
    const todayIndex = labels.indexOf(todayStr)
    dataValues[todayIndex] = totalTWD
  } else if (totalTWD > 0) {
    labels.push(todayStr)
    dataValues.push(totalTWD)
  }

  lineChartData.value = {
    labels: labels,
    datasets: [{
      label: '總資產市值走勢 (TWD)',
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
  const savedBank = await localforage.getItem(BANK_DB_KEY)
  if (savedBank) bankTransactions.value = savedBank
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
  await localforage.setItem(GB_DB_KEY, JSON.parse(JSON.stringify(goldBondsTransactions.value)))
  showGBForm.value = false
  resetGBForm()
  await calculatePortfolio()
}

const saveBankTransaction = async () => {
  const newTx = {
    id: crypto.randomUUID(),
    bankName: bankFormData.value.bankName.trim(),
    accountType: bankFormData.value.accountType,
    currency: bankFormData.value.currency,
    balance: Number(bankFormData.value.balance) || 0,
    date: bankFormData.value.date
  }
  bankTransactions.value.push(newTx)
  await localforage.setItem(BANK_DB_KEY, JSON.parse(JSON.stringify(bankTransactions.value)))
  showBankForm.value = false
  resetBankForm()
  await calculatePortfolio()
}

const deleteBankTransaction = async (id) => {
  bankTransactions.value = bankTransactions.value.filter(tx => tx.id !== id)
  await localforage.setItem(BANK_DB_KEY, JSON.parse(JSON.stringify(bankTransactions.value)))
  await calculatePortfolio()
}

const deleteGBTransaction = async (id) => {
  goldBondsTransactions.value = goldBondsTransactions.value.filter(tx => tx.id !== id)
  await localforage.setItem(GB_DB_KEY, JSON.parse(JSON.stringify(goldBondsTransactions.value)))
  await calculatePortfolio()
}

const deleteTransaction = async (id) => {
  transactions.value = transactions.value.filter(tx => tx.id !== id)
  await localforage.setItem(DB_KEY, JSON.parse(JSON.stringify(transactions.value)))
  await calculatePortfolio()
}

const exportBackup = () => {
  const backupData = {
    transactions: transactions.value,
    goldBondsTransactions: goldBondsTransactions.value,
    bankTransactions: bankTransactions.value,
    stockTargets: stockTargets.value,
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
      if (content.bankTransactions && Array.isArray(content.bankTransactions)) {
        bankTransactions.value = content.bankTransactions
        await localforage.setItem(BANK_DB_KEY, JSON.parse(JSON.stringify(bankTransactions.value)))
      }
      if (content.stockTargets) {
        stockTargets.value = content.stockTargets
        await localforage.setItem(TARGET_DB_KEY, JSON.parse(JSON.stringify(stockTargets.value)))
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

const resetBankForm = () => {
  bankFormData.value = {
    bankName: '',
    accountType: '活存',
    currency: 'TWD',
    balance: null,
    date: new Date().toISOString().split('T')[0]
  }
}

const filteredTransactionsByTicker = computed(() => {
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

      <!-- 主導航目錄選單 -->
      <div class="nav-menu-grid">
        <button :class="['nav-btn', currentTab === 'overview' ? 'active-nav' : '']" @click="currentTab = 'overview'">🏠 總覽首頁</button>
        <button :class="['nav-btn', currentTab === 'TW' ? 'active-nav' : '']" @click="currentTab = 'TW'">📈 台股</button>
        <button :class="['nav-btn', currentTab === 'US' ? 'active-nav' : '']" @click="currentTab = 'US'">📉 美股</button>
        <button :class="['nav-btn', currentTab === 'funds' ? 'active-nav' : '']" @click="currentTab = 'funds'">🌐 基金</button>
        <button :class="['nav-btn', currentTab === 'gold_bonds' ? 'active-nav' : '']" @click="currentTab = 'gold_bonds'">🥇 黃金/債券</button>
        <button :class="['nav-btn', currentTab === 'bank' ? 'active-nav' : '']" @click="currentTab = 'bank'">🏦 銀行帳戶</button>
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
          <span>黃金/債券市值：${{ goldBondsAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span>
          <br>
          <small>未實現：
            <strong :class="goldBondsUnrealizedPnL >= 0 ? 'profit' : 'loss'">
              ${{ goldBondsUnrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD 
              ({{ goldBondsTotalCost > 0 ? ((goldBondsUnrealizedPnL / goldBondsTotalCost) * 100).toFixed(2) : 0 }}%)
            </strong>
          </small>
        </div>
        <div class="market-summary-item" style="border: none;">
          <span>銀行帳戶市值：${{ bankAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span>
        </div>
      </div>

      <!-- 圖表區塊 -->
      <section class="chart-section">
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
    <!-- 4. 基金子目錄 (funds) -->
    <!-- ========================================== -->
    <main v-if="currentTab === 'funds'">
      <section class="placeholder-section">
        <h3>🌐 基金資產管理</h3>
        <p class="empty-msg">此子目錄建置中，稍待將新增基金相關追蹤功能。</p>
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
              <div class="card-header">
                <div>
                  <strong class="stock-name">{{ item.name }}</strong> 
                  <span class="stock-ticker">({{ item.category }})</span>
                </div>
                <span>{{ item.amount.toLocaleString() }} {{ item.category === '黃金' ? '克' : '單位' }}</span>
              </div>
              <div class="card-body">
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
              <button @click="deleteGBTransaction(tx.id)" class="delete-dark-btn">刪除</button>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <!-- ========================================== -->
    <!-- 6. 銀行帳戶子目錄 (bank) -->
    <!-- ========================================== -->
    <main v-if="currentTab === 'bank'">
      <!-- 頂端各幣別與總市值摘要 -->
      <div class="dividend-summary-box">
        <p><strong>銀行帳戶換算台幣總值：</strong> <span class="div-highlight">${{ bankAssetsTWD.toLocaleString(undefined, { maximumFractionDigits: 0 }) }} TWD</span></p>
        <div class="yearly-div-list" v-if="Object.keys(bankCurrenciesSummary).length > 0">
          <small v-for="(amt, cur) in bankCurrenciesSummary" :key="cur" class="yearly-tag">
            {{ cur }}: {{ amt.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} 
            (折合NTD: ${{ Math.round(amt * (exchangeRates.value[cur] || 1)).toLocaleString() }})
          </small>
        </div>
      </div>

      <section class="portfolio">
        <div class="chart-header-row" style="margin-bottom: 12px;">
          <h3 style="margin: 0;">各銀行帳戶列表</h3>
          <button @click="isBankOpen = !isBankOpen" class="toggle-chart-btn">
            {{ isBankOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>

        <div v-show="isBankOpen">
          <p v-if="bankPortfolioRaw.length === 0" class="empty-msg">目前無銀行帳戶資料。</p>
          
          <div v-else class="card-grid">
            <div v-for="acc in bankPortfolioRaw" :key="acc.id" class="stock-card">
              <div class="card-header">
                <div>
                  <strong class="stock-name">{{ acc.bankName }}</strong> 
                  <span class="stock-ticker">({{ acc.accountType }})</span>
                </div>
                <span>{{ acc.currency }} {{ acc.balance.toLocaleString() }}</span>
              </div>
              <div class="card-body">
                <p>折合台幣：<strong>${{ Math.round(acc.marketValueTWD).toLocaleString() }} TWD</strong></p>
                <small style="color: #64748b;">登記日期：{{ acc.date }}</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 銀行歷史紀錄 (可收合) -->
      <section class="history-dark-section" style="margin-top: 20px;">
        <div class="chart-header-row" style="margin-bottom: 0;">
          <h3 style="margin: 0; border: none; padding: 0;">銀行帳戶紀錄清單</h3>
          <button @click="isBankHistoryOpen = !isBankHistoryOpen" class="toggle-chart-btn" style="background: #334155; border-color: #475569; color: #f8fafc;">
            {{ isBankHistoryOpen ? '收起 🔼' : '展開 🔽' }}
          </button>
        </div>
        
        <div v-show="isBankHistoryOpen" style="margin-top: 15px;">
          <p v-if="bankTransactions.length === 0" class="empty-dark-msg">目前無銀行帳戶紀錄。</p>
          <ul v-else class="tx-dark-list">
            <li v-for="tx in bankTransactions.slice().reverse()" :key="tx.id" class="tx-dark-item">
              <div class="tx-info">
                <strong class="tx-ticker">{{ tx.bankName }}</strong>
                <span class="tag-dark-div" style="margin-right: 6px;">{{ tx.accountType }}</span>
                <span class="tag-dark-buy">{{ tx.currency }}</span>
                <br>
                <small class="tx-sub">{{ tx.date }} | 金額: ${{ tx.balance.toLocaleString() }} {{ tx.currency }}</small>
              </div>
              <button @click="deleteBankTransaction(tx.id)" class="delete-dark-btn">刪除</button>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <!-- 浮動新增按鈕 -->
    <button @click="currentTab === 'gold_bonds' ? showGBForm = (currentTab === 'gold_bonds') : (currentTab === 'bank' ? showBankForm = true : showForm = true)" class="fab-button" v-if="currentTab !== 'funds' && currentTab !== 'overview'">+</button>
    <button @click="showGBForm = true" class="fab-button" v-if="currentTab === 'gold_bonds'">+</button>

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

    <!-- 新增黃金/債券交易彈窗 -->
    <div v-if="showGBForm" class="modal-overlay">
      <div class="modal-content">
        <h3>新增黃金/債券紀錄</h3>
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
            <button type="button" @click="showGBForm = false" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">儲存</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 新增銀行帳戶彈窗 -->
    <div v-if="showBankForm" class="modal-overlay">
      <div class="modal-content">
        <h3>新增銀行帳戶紀錄</h3>
        <form @submit.prevent="saveBankTransaction">
          <div class="form-group"><label>銀行名稱</label><input v-model="bankFormData.bankName" type="text" required placeholder="如：國泰世華、郵局、兆豐"></div>
          <div class="form-group"><label>日期</label><input v-model="bankFormData.date" type="date" required></div>
          <div class="form-group">
            <label>帳戶類型</label>
            <select v-model="bankFormData.accountType">
              <option value="活存">活存</option>
              <option value="定存">定存</option>
            </select>
          </div>
          <div class="form-group">
            <label>幣別</label>
            <select v-model="bankFormData.currency">
              <option value="TWD">台幣 (TWD)</option>
              <option value="USD">美金 (USD)</option>
              <option value="JPY">日元 (JPY)</option>
              <option value="AUD">澳幣 (AUD)</option>
              <option value="EUR">歐元 (EUR)</option>
              <option value="KRW">韓元 (KRW)</option>
            </select>
          </div>
          <div class="form-group"><label>現值金額</label><input v-model="bankFormData.balance" type="number" step="any" required placeholder="請輸入帳戶現值"></div>

          <div class="form-actions">
            <button type="button" @click="showBankForm = false" class="cancel-btn">取消</button>
            <button type="submit" class="submit-btn">儲存</button>
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
  </div>
</template>

<style scoped>
.app-container { font-family: sans-serif; padding: 16px; max-width: 600px; margin: 0 auto; padding-bottom: 80px; }
header { background-color: #f4f4f5; padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 15px; }

.nav-menu-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 15px; }
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
.card-body p { margin: 5px 0; font-size: 0.95em; color: #555; }
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