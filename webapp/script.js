document.addEventListener("DOMContentLoaded", () => {
  const tg = window.Telegram.WebApp;
  const tgInitData = tg.initData;

  // Initialize Telegram WebApp
  tg.ready();
  tg.expand();
  try {
    tg.disableVerticalSwipes();
  } catch (e) {
    console.log("Vertical swipes disable not supported");
  }

  // --- CONFIGURATION ---
  const API_URLS = {
    TRANSACTIONS: "/api/transactions",
    BALANCE: "/api/balance",
    CATEGORIES: "/api/categories",
    AI_ADVICE: "/api/ai/advice",
    ANALYTICS_SUMMARY: "/api/analytics/summary",
    ANALYTICS_CALENDAR: "/api/analytics/calendar",
    USER_RESET: "/api/users/me/reset",
    USER_SETTINGS_CURRENCY: "/api/users/me/settings/currency",
    USER_PROFILE: "/api/users/me",
  };

  const CURRENCY_SYMBOLS = {
    USD: "$",
    TRY: "₺",
    KZT: "₸",
    RUB: "₽",
    EUR: "€",
    GBP: "£",
    UAH: "₴",
  };

  // --- STATE MANAGEMENT ---
  const state = {
    transactions: [],
    categories: [],
    currencySymbol: "$",
    baseCurrencyCode: "USD",
    editTransaction: null,
    quickCategory: null,
    categoryBeingEdited: null,
    activeBottomSheet: null,
    lastActiveScreen: "home-screen",
    isInitialLoad: true,
    chart: null,
    analyticsDate: new Date(),
    summaryRange: "month",
    summaryType: "expense",
    categoryType: "expense",
    aiRange: "month",
    calendarSummary: { income: 0, expense: 0, net: 0 },
    isLoading: false,

    // Scroll Position
    savedScrollPosition: 0,

    // Infinite Scroll
    offset: 0,
    limit: 100,
    isAllLoaded: false,
    isLoadingMore: false,
    rates: {}, // Cache for exchange rates
  };

  // --- HELPERS & FORMATTERS ---

  function setupCurrencyPicker(selectElement, labelElement) {
    if (!selectElement || !labelElement) return;

    selectElement.addEventListener("change", (e) => {
      const code = e.target.value;
      labelElement.textContent = CURRENCY_SYMBOLS[code] || code;
      localStorage.setItem("last_used_currency", code);
    });
  }

  function updateAiDescriptions(range) {
    if (!DOM.ai.btnAdvice || !DOM.ai.btnSummary || !DOM.ai.btnAnomaly) return;

    if (range === "all") {
      DOM.ai.btnAdvice.querySelector("p").textContent = "An actionable tip based on your entire spending history.";
      DOM.ai.btnSummary.querySelector("p").textContent =
        "A detailed breakdown of your total income and expenses for all-time.";
      DOM.ai.btnAnomaly.querySelector("p").textContent =
        "Find the largest single expense recorded in your entire history.";
    } else {
      const rangeCapitalized = range.charAt(0).toUpperCase() + range.slice(1);
      DOM.ai.btnAdvice.querySelector(
        "p"
      ).textContent = `An actionable financial tip based on your activity for this ${range}.`;
      DOM.ai.btnSummary.querySelector(
        "p"
      ).textContent = `A detailed breakdown of your income and expenses for this ${range}.`;
      DOM.ai.btnAnomaly.querySelector(
        "p"
      ).textContent = `Find the single largest expense you made during this ${range}.`;
    }
  }

  async function apiRequest(url, options = {}) {
    if (!tgInitData) {
      console.error("tgInitData is missing.");
      tg.showAlert("Authentication data is missing. Please restart the app.");
      throw new Error("No init data");
    }

    const headers = {
      "X-Telegram-Init-Data": tgInitData,
      "X-Timezone-Offset": String(new Date().getTimezoneOffset()),
      "Content-Type": "application/json",
      ...options.headers,
    };

    const config = { ...options, headers: headers };

    try {
      const response = await fetch(url, config);
      if (response.status === 401 || response.status === 403) {
        tg.showAlert("Authentication Failed. Please try restarting the app inside Telegram.");
      }
      return response;
    } catch (error) {
      console.error("Network Error:", error);
      throw error;
    }
  }

  function parseDateFromUTC(dateString) {
    if (!dateString) return new Date();
    if (dateString instanceof Date) return dateString;

    // 1. Handle simple YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return new Date(dateString + "T00:00:00Z");
    }

    // 2. Handle ISO strings
    if (typeof dateString === "string" && dateString.includes("T")) {
        // If no timezone indicator (Z or +HH:MM or -HH:MM), assume UTC
        const hasTimezone = /([Zz]|[+-]\d{2}:?\d{2})$/.test(dateString);
        if (!hasTimezone) {
            return new Date(dateString + "Z");
        }
    }
    
    return new Date(dateString);
  }

  const defaultEmojis = {
    Food: "🍔",
    Transport: "🚌",
    Housing: "🏠",
    Salary: "💰",
    Freelance: "💻",
    Gifts: "🎁",
  };
  const defaultIconExpense = "📦";
  const defaultIconIncome = "💎";

  const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const headerDateFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const preciseNumberFormatter = new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formatDateForTitle = (date) => headerDateFormatter.format(date);
  const formatTime = (date) => timeFormatter.format(date);

  function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseCategory(fullName) {
    if (!fullName) return { icon: null, name: "" };
    const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji})(\p{Emoji_Modifier}|\uFE0F)*/u;
    const match = fullName.match(emojiRegex);
    if (match && match[0]) {
      return { icon: match[0], name: fullName.substring(match[0].length).trim() };
    }
    return { icon: null, name: fullName.trim() };
  }

  function formatCurrency(amount, symbol = state.currencySymbol) {
    const num = parseFloat(amount);
    if (isNaN(num)) return `${symbol}0.00`;
    return `${symbol}${num.toFixed(2)}`;
  }

  function formatCurrencyForSummary(amount) {
    const num = parseFloat(amount);
    if (isNaN(num)) return `${state.currencySymbol}0.00`;

    const sign = num < 0 ? "-" : num > 0 ? "+" : "";
    const absAmount = Math.abs(num);

    let formattedAmount;
    if (absAmount >= 1000000) formattedAmount = (absAmount / 1000000).toFixed(2) + "M";
    else if (absAmount >= 10000) formattedAmount = (absAmount / 1000).toFixed(0) + "K";
    else if (absAmount >= 1000) formattedAmount = (absAmount / 1000).toFixed(1) + "K";
    else formattedAmount = absAmount.toFixed(2);

    return num === 0 ? `${state.currencySymbol}0.00` : `${sign}${state.currencySymbol}${formattedAmount}`;
  }

  function formatForDayMarker(amount) {
    const num = parseFloat(amount);
    if (isNaN(num) || num === 0) return "";

    const absAmount = Math.abs(Math.round(num));
    const sign = num < 0 ? "-" : "+";
    if (absAmount >= 1000000) return `${sign}${(absAmount / 1000000).toFixed(1)}M`;
    if (absAmount >= 1000) return `${sign}${(absAmount / 1000).toFixed(0)}K`;
    return `${sign}${absAmount}`;
  }

  // --- DOM ELEMENTS ---
  const DOM = {
    screens: document.querySelectorAll(".screen"),
    backdrop: document.getElementById("backdrop"),
    home: {
      screen: document.getElementById("home-screen"),
      balanceAmount: document.getElementById("balance-amount"),
      listContainer: document.getElementById("transactions-list"),
    },
    analytics: {
      screen: document.getElementById("analytics-screen"),
      segBtnSummary: document.getElementById("seg-btn-summary"),
      segBtnCalendar: document.getElementById("seg-btn-calendar"),
      summaryPane: document.getElementById("summary-pane"),
      calendarPane: document.getElementById("calendar-pane"),
      summaryTypeFilter: document.getElementById("summary-type-filter"),
      summaryRangeFilter: document.getElementById("summary-range-filter"),
      doughnutChartCanvas: document.getElementById("doughnut-chart"),
      summaryList: document.getElementById("summary-list"),
    },
    calendar: {
      container: document.getElementById("calendar-container"),
      prevMonthBtn: document.getElementById("prev-month-btn"),
      nextMonthBtn: document.getElementById("next-month-btn"),
      monthSelect: document.getElementById("month-select"),
      yearSelect: document.getElementById("year-select"),
      summaryIncome: document.getElementById("calendar-summary-income"),
      summaryExpense: document.getElementById("calendar-summary-expense"),
      summaryNet: document.getElementById("calendar-summary-net"),
      boxIncome: document.getElementById("calendar-summary-box-income"),
      boxExpense: document.getElementById("calendar-summary-box-expense"),
      boxNet: document.getElementById("calendar-summary-box-net"),
    },
    ai: {
      screen: document.getElementById("ai-screen"),
      dateFilter: document.getElementById("ai-date-filter"),
      featuresList: document.getElementById("ai-features-list"),
      btnAdvice: document.getElementById("ai-btn-advice"),
      btnSummary: document.getElementById("ai-btn-summary"),
      btnAnomaly: document.getElementById("ai-btn-anomaly"),
      resultContainer: document.getElementById("ai-result-container"),
      resultTitle: document.getElementById("ai-result-title"),
      resultBody: document.getElementById("ai-result-body"),
      resultBackBtn: document.getElementById("ai-result-back-btn"),
    },
    settings: {
      screen: document.getElementById("settings-screen"),
      currencySelect: document.getElementById("currency-select"),
      resetDataBtn: document.getElementById("reset-data-btn"),
    },
    categories: {
      screen: document.getElementById("categories-screen"),
      backBtn: document.getElementById("categories-back-btn"),
      segBtnExpense: document.getElementById("cat-seg-btn-expense"),
      segBtnIncome: document.getElementById("cat-seg-btn-income"),
      newIconInput: document.getElementById("new-category-icon"),
      newNameInput: document.getElementById("new-category-name"),
      addBtn: document.getElementById("add-category-btn"),
      list: document.getElementById("categories-list"),
    },
    editCategory: {
      screen: document.getElementById("edit-category-screen"),
      nameInput: document.getElementById("edit-category-name"),
      iconInput: document.getElementById("edit-category-icon"),
      saveBtn: document.getElementById("save-category-changes-btn"),
      deleteBtn: document.getElementById("delete-category-permanent-btn"),
      backBtn: document.getElementById("edit-category-back-btn"),
    },
    fullForm: {
      screen: document.getElementById("full-form-screen"),
      title: document.getElementById("form-title"),
      typeWrapper: document.getElementById("form-type-wrapper"),
      typeExpense: document.getElementById("form-type-expense"),
      typeIncome: document.getElementById("form-type-income"),
      categorySelect: document.getElementById("category-select"),

      amountInput: document.getElementById("transaction-amount"),
      currencySelect: document.getElementById("form-currency-select"),
      currencyLabel: document.getElementById("form-currency-label"),

      dateInput: document.getElementById("transaction-date"),
      noteInput: document.getElementById("transaction-note"),

      saveBtn: document.getElementById("save-btn"),
      cancelBtn: document.getElementById("cancel-btn"),
      deleteBtn: document.getElementById("delete-btn"),
    },
    quickAdd: {
      screen: document.getElementById("quick-add-screen"),
      manageBtn: document.getElementById("quick-add-manage-categories-btn"),
      gridExpense: document.getElementById("quick-add-grid-expense"),
      gridIncome: document.getElementById("quick-add-grid-income"),
      manualExpense: document.getElementById("quick-manual-expense"),
      manualIncome: document.getElementById("quick-manual-income"),
    },
    daySheet: {
      sheet: document.getElementById("day-details-sheet"),
      header: document.querySelector("#day-details-sheet .sheet-header"),
      contentWrapper: document.getElementById("sheet-content-wrapper"),
      title: document.getElementById("sheet-date-title"),
      list: document.getElementById("sheet-transactions-list"),
    },
    quickModal: {
      sheet: document.getElementById("quick-add-modal-sheet"),
      header: document.querySelector("#quick-add-modal-sheet .sheet-header"),
      title: document.getElementById("quick-modal-title"),

      currencySelect: document.getElementById("quick-currency-select"),
      currencyLabel: document.getElementById("quick-currency-label"),

      amountInput: document.getElementById("quick-modal-amount"),

      noteToggleBtn: document.getElementById("quick-add-note-toggle"),
      noteInput: document.getElementById("quick-modal-note"),

      saveBtn: document.getElementById("quick-modal-save-btn"),
    },
    summarySheet: {
      sheet: document.getElementById("summary-details-sheet"),
      header: document.querySelector("#summary-details-sheet .sheet-header"),
      title: document.getElementById("summary-sheet-title"),
      currency: document.getElementById("summary-sheet-currency"),
      amountInput: document.getElementById("summary-sheet-amount"),
    },
    tabs: {
      home: document.getElementById("tab-home"),
      analytics: document.getElementById("tab-analytics"),
      add: document.getElementById("tab-add"),
      ai: document.getElementById("tab-ai"),
      settings: document.getElementById("tab-settings"),
    },
  };

  // --- BUSINESS LOGIC ---

  async function fetchAndRenderBalance() {
    const container = DOM.home.balanceAmount.closest(".total-container");
    const oldBalanceText = DOM.home.balanceAmount.textContent;

    try {
      const response = await apiRequest(API_URLS.BALANCE);
      if (!response.ok) return;
      const data = await response.json();
      const serverBalance = parseFloat(data.balance);

      const sign = serverBalance < 0 ? "-" : "";
      const absBalance = Math.abs(serverBalance);
      const hasCents = absBalance % 1 !== 0;
      const balanceFormatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: 2,
      });
      const newBalanceText = `${sign}${state.currencySymbol}${balanceFormatter.format(absBalance)}`;

      DOM.home.balanceAmount.textContent = newBalanceText;

      if (!oldBalanceText.includes(state.currencySymbol)) return;

      if (newBalanceText === oldBalanceText || !container || state.isInitialLoad) return;

      const oldBalanceVal = parseFloat(oldBalanceText.replace(/[^0-9.-]+/g, "")) || 0;
      const classToAdd = serverBalance > oldBalanceVal ? "balance-flash-positive" : "balance-flash-negative";

      container.classList.remove("balance-flash-positive", "balance-flash-negative");
      requestAnimationFrame(() => container.classList.add(classToAdd));
      container.addEventListener("animationend", () => container.classList.remove(classToAdd), { once: true });
    } catch (e) {
      console.error("Balance load error", e);
    }
  }

  function renderErrorState(container, retryCallback, message = "Failed to load data.") {
    container.innerHTML = `
        <div class="list-placeholder">
            <span class="icon">☁️</span>
            <h3>Couldn't Connect</h3>
            <p>${message} Please check your connection and try again.</p>
            <button class="placeholder-btn">Retry</button>
        </div>`;
    const retryBtn = container.querySelector(".placeholder-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        tg.HapticFeedback.impactOccurred("light");
        retryCallback();
      });
    }
  }

  function showScreen(screenId, restoreScroll = false) {
    DOM.screens.forEach((s) => s.classList.add("hidden"));
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) screenToShow.classList.remove("hidden");

    if (restoreScroll && screenId === "home-screen") {
      window.scrollTo(0, state.savedScrollPosition);
    } else {
      window.scrollTo(0, 0);
    }

    DOM.tabs.home.classList.toggle("active", screenId === "home-screen");
    DOM.tabs.analytics.classList.toggle("active", screenId === "analytics-screen");
    DOM.tabs.ai.classList.toggle("active", screenId === "ai-screen");
    DOM.tabs.settings.classList.toggle("active", screenId === "settings-screen");
    DOM.tabs.add.classList.toggle(
      "active",
      ["quick-add-screen", "full-form-screen", "categories-screen", "edit-category-screen"].includes(screenId)
    );

    if (["home-screen", "analytics-screen", "ai-screen", "settings-screen", "quick-add-screen"].includes(screenId)) {
      sessionStorage.setItem("lastActiveScreen", screenId);
      state.lastActiveScreen = screenId;
    }

    if (screenId === "analytics-screen") {
      const lastAnalyticsTab = sessionStorage.getItem("lastAnalyticsTab") || "summary";
      if (lastAnalyticsTab === "calendar") {
        DOM.analytics.summaryPane.classList.add("hidden");
        DOM.analytics.calendarPane.classList.remove("hidden");
        DOM.analytics.segBtnSummary.classList.remove("active");
        DOM.analytics.segBtnCalendar.classList.add("active");
      } else {
        DOM.analytics.summaryPane.classList.remove("hidden");
        DOM.analytics.calendarPane.classList.add("hidden");
        DOM.analytics.segBtnSummary.classList.add("active");
        DOM.analytics.segBtnCalendar.classList.remove("active");
      }
      loadAnalyticsPage();
    } else if (screenId === "categories-screen") {
      loadCategoriesScreen();
    } else if (screenId === "ai-screen") {
      DOM.ai.featuresList.classList.remove("hidden");
      DOM.ai.resultContainer.classList.add("hidden");
    } else if (screenId === "quick-add-screen") {
      renderQuickAddGrids();
    }
  }

  // --- DATA LOADERS ---
  async function loadAllCategories() {
    try {
      const [expenseRes, incomeRes] = await Promise.all([
        apiRequest(`${API_URLS.CATEGORIES}?type=expense`),
        apiRequest(`${API_URLS.CATEGORIES}?type=income`),
      ]);

      if (!expenseRes.ok || !incomeRes.ok) throw new Error("Categories load error");

      const expenseCats = await expenseRes.json();
      const incomeCats = await incomeRes.json();

      state.categories = [
        ...expenseCats.map((c) => ({ ...c, type: "expense" })),
        ...incomeCats.map((c) => ({ ...c, type: "income" })),
      ];
      renderQuickAddGrids();
    } catch (error) {
      renderErrorState(
        DOM.quickAdd.gridExpense,
        () => {
          DOM.quickAdd.gridExpense.innerHTML = `<p class="list-placeholder" style="grid-column:1/-1;">Loading...</p>`;
          loadAllCategories();
        },
        "Failed to load your categories."
      );
      DOM.quickAdd.gridIncome.innerHTML = "";
    }
  }

  async function loadCategoriesForForm(type) {
    DOM.fullForm.categorySelect.innerHTML = "<option value=''>Loading...</option>";
    const categories = state.categories.filter((c) => c.type === type);
    DOM.fullForm.categorySelect.innerHTML = "";
    if (categories.length === 0) {
      DOM.fullForm.categorySelect.innerHTML = "<option value=''>No categories found</option>";
      return;
    }
    categories.forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat.id;
      const { name } = parseCategory(cat.name);
      option.textContent = name;
      DOM.fullForm.categorySelect.appendChild(option);
    });
  }

  function createTransactionElement(tx) {
    const item = document.createElement("div");
    item.className = "expense-item " + tx.type;
    item.dataset.txId = tx.id;

    const editIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>`;
    const trashIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clip-rule="evenodd" /></svg>`;

    const txDate = parseDateFromUTC(tx.date);
    const formattedTime = formatTime(txDate);
    const { icon: customEmoji, name: categoryName } = parseCategory(tx.category);

    let categoryDisplay;
    if (customEmoji) {
      categoryDisplay = `${customEmoji} ${categoryName}`;
    } else if (defaultEmojis[categoryName]) {
      categoryDisplay = `${defaultEmojis[categoryName]} ${categoryName}`;
    } else {
      const defaultIcon = tx.type === "income" ? defaultIconIncome : defaultIconExpense;
      categoryDisplay = `${defaultIcon} ${categoryName}`;
    }

    const timeHtml = `<span class="tx-time">${formattedTime}</span>`;
    let noteHtml = "";
    if (tx.note && tx.note.trim() !== "") {
      noteHtml = `<span class="tx-separator">•</span><span class="tx-note">${tx.note}</span>`;
    }

    let amountHTML = "";
    if (tx.currency && tx.currency !== state.baseCurrencyCode && tx.original_amount) {
      const symbol = CURRENCY_SYMBOLS[tx.currency] || tx.currency;
      amountHTML = `
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span class="original-amount ${tx.type}" style="font-size: 0.95em; font-weight:600;">
                    ${tx.type === "income" ? "+" : "-"}${symbol}${parseFloat(tx.original_amount).toFixed(2)}
                </span>
                ${
                   parseFloat(tx.amount) !== 0 
                   ? `<span class="base-amount" style="font-size: 0.75em; opacity: 0.6;">~${formatCurrency(tx.amount)}</span>`
                   : ""
                }
            </div>
        `;
    } else {
      amountHTML = `
            <span class="tx-amount ${tx.type}">
                ${tx.type === "income" ? "+" : "-"}${formatCurrency(tx.amount)}
            </span>
        `;
    }

    item.innerHTML = `
            <div class="expense-item-delete-bg">
                ${trashIconSvg}
            </div>
            <div class="expense-item-content">
                <div class="tx-info">
                    <span class="tx-category">${categoryDisplay}</span>
                    <div class="tx-bottom-row">
                        ${timeHtml}
                        ${noteHtml}
                    </div>
                </div>
                <div class="expense-item-details">
                    ${amountHTML}
                    <button class="edit-btn" data-tx-id="${tx.id}">${editIconSvg}</button>
                </div>
            </div>
        `;
    return item;
  }

  function renderTransactions(transactions = [], highlightId = null, isAppend = false) {
    const list = DOM.home.listContainer;
    if (!isAppend) list.innerHTML = "";

    if (!isAppend && transactions.length === 0) {
      list.innerHTML = `
                <div class="list-placeholder">
                    <span class="icon">📁</span>
                    <h3>All Clear!</h3>
                    <p>Your new transactions will appear here.</p>
                    <p>Tap the <b>(+)</b> button to add your first transaction.</p>
                </div>
            `;
      return;
    }

    transactions.forEach((tx) => {
      const txDate = parseDateFromUTC(tx.date);
      const dateHeaderStr = formatDateForTitle(txDate);

      let currentGroup = list.lastElementChild;
      let groupToAppend;

      if (
        currentGroup &&
        currentGroup.classList.contains("transaction-group") &&
        currentGroup.dataset.date === dateHeaderStr
      ) {
        groupToAppend = currentGroup;
      } else {
        groupToAppend = document.createElement("div");
        groupToAppend.className = "transaction-group";
        groupToAppend.dataset.date = dateHeaderStr;

        const headerEl = document.createElement("div");
        headerEl.className = "date-header";
        headerEl.textContent = dateHeaderStr;

        groupToAppend.appendChild(headerEl);
        list.appendChild(groupToAppend);
      }

      const item = createTransactionElement(tx);
      if (tx.id === highlightId) {
        item.classList.add("new-item-animation");
        item.addEventListener("animationend", () => item.classList.remove("new-item-animation"), { once: true });
      }
      groupToAppend.appendChild(item);
    });
  }

  function renderSkeleton() {
    DOM.home.listContainer.innerHTML = `
        <div class="skeleton-loader">
          <div class="skeleton-item skeleton-header"></div>
          <div class="skeleton-item skeleton-tx"></div>
          <div class="skeleton-item skeleton-tx"></div>
          <div class="skeleton-item skeleton-tx"></div>
        </div>`;
  }

  async function loadTransactions(isAppend = false, highlightId = null) {
    if (state.isLoadingMore && isAppend) return;
    if (state.isAllLoaded && isAppend) return;

    state.isLoadingMore = true;
    if (!isAppend) {
      state.offset = 0;
      state.isAllLoaded = false;
      state.transactions = [];
    }

    try {
      const url = `${API_URLS.TRANSACTIONS}?limit=${state.limit}&offset=${state.offset}`;
      const response = await apiRequest(url);
      if (!response.ok) throw new Error("Network response was not ok");

      const newTransactions = await response.json();

      if (newTransactions.length < state.limit) {
        state.isAllLoaded = true;
      }

      if (isAppend) {
        state.transactions = [...state.transactions, ...newTransactions];
        state.offset += newTransactions.length;
        renderTransactions(newTransactions, null, true);
      } else {
        state.transactions = newTransactions;
        state.offset = newTransactions.length;
        renderTransactions(newTransactions, highlightId, false);
      }
    } catch (error) {
      if (!isAppend) {
        renderErrorState(DOM.home.listContainer, () => loadTransactions(false), "Failed to load transactions.");
      }
    } finally {
      state.isLoadingMore = false;
    }
  }

  function renderQuickAddGrids() {
    DOM.quickAdd.gridExpense.innerHTML = "";
    DOM.quickAdd.gridIncome.innerHTML = "";
    state.categories.forEach((cat) => {
      const { icon: customEmoji, name: categoryName } = parseCategory(cat.name);
      let emojiToShow;
      if (customEmoji) {
        emojiToShow = customEmoji;
      } else if (defaultEmojis[categoryName]) {
        emojiToShow = defaultEmojis[categoryName];
      } else {
        emojiToShow = cat.type === "income" ? defaultIconIncome : defaultIconExpense;
      }

      const btn = document.createElement("button");
      btn.className = "category-grid-btn";
      btn.innerHTML = `<span class="icon">${emojiToShow}</span><span>${categoryName}</span>`;
      btn.addEventListener("click", () => openQuickModal(cat));
      if (cat.type === "income") DOM.quickAdd.gridIncome.appendChild(btn);
      else DOM.quickAdd.gridExpense.appendChild(btn);
    });
  }

  // --- FORM HANDLING ---

  function handleEditTransactionClick(e) {
    const editBtn = e.target.closest(".edit-btn");
    if (!editBtn) return;
    tg.HapticFeedback.impactOccurred("light");
    const txId = parseInt(editBtn.dataset.txId, 10);
    const transactionToEdit = state.transactions.find((tx) => tx.id === txId);
    if (transactionToEdit) openEditScreen(transactionToEdit);
  }

  async function openEditScreen(tx) {
    state.savedScrollPosition = window.scrollY;
    state.editTransaction = tx;
    DOM.fullForm.title.textContent = "Edit Transaction";
    DOM.fullForm.saveBtn.textContent = "Save Changes";
    DOM.fullForm.deleteBtn.classList.remove("hidden");
    if (DOM.fullForm.typeWrapper) DOM.fullForm.typeWrapper.classList.add("hidden");

    if (tx.type === "income") {
      DOM.fullForm.typeIncome.classList.add("active");
      DOM.fullForm.typeExpense.classList.remove("active");
    } else {
      DOM.fullForm.typeExpense.classList.add("active");
      DOM.fullForm.typeIncome.classList.remove("active");
    }

    DOM.fullForm.amountInput.value = parseFloat(tx.original_amount ? tx.original_amount : tx.amount);

    let currency = tx.currency;
    if (!currency) currency = state.baseCurrencyCode;
    if (!currency) currency = "USD";

    if (DOM.fullForm.currencySelect) {
      DOM.fullForm.currencySelect.value = currency;
      const label = DOM.fullForm.currencyLabel;
      if (label) label.textContent = CURRENCY_SYMBOLS[currency] || currency;
    }

    const dateObj = parseDateFromUTC(tx.date);
    DOM.fullForm.dateInput.value = getLocalDateString(dateObj);
    DOM.fullForm.noteInput.value = tx.note || "";

    await loadCategoriesForForm(tx.type);
    DOM.fullForm.categorySelect.value = tx.category_id;
    closeBottomSheet();
    showScreen("full-form-screen");
  }

  function openAddScreen() {
    state.editTransaction = null;
    showScreen("quick-add-screen");
  }

  async function openFullForm(type = "expense") {
    state.savedScrollPosition = window.scrollY;
    state.editTransaction = null;
    DOM.fullForm.title.textContent = type === "income" ? "New Income" : "New Expense";
    DOM.fullForm.saveBtn.textContent = "Save Transaction";
    DOM.fullForm.deleteBtn.classList.add("hidden");
    if (DOM.fullForm.typeWrapper) DOM.fullForm.typeWrapper.classList.add("hidden");

    DOM.fullForm.amountInput.value = "";
    DOM.fullForm.noteInput.value = "";

    if (DOM.fullForm.currencySelect) {
      const lastCurr = localStorage.getItem("last_used_currency") || "USD";
      DOM.fullForm.currencySelect.value = lastCurr;
      if (DOM.fullForm.currencyLabel) DOM.fullForm.currencyLabel.textContent = CURRENCY_SYMBOLS[lastCurr] || lastCurr;
    }

    DOM.fullForm.dateInput.value = getLocalDateString(new Date());

    if (type === "income") {
      DOM.fullForm.typeIncome.classList.add("active");
      DOM.fullForm.typeExpense.classList.remove("active");
    } else {
      DOM.fullForm.typeExpense.classList.add("active");
      DOM.fullForm.typeIncome.classList.remove("active");
    }
    await loadCategoriesForForm(type);
    showScreen("full-form-screen");
  }

  async function deleteTransaction(txId) {
    try {
      const response = await apiRequest(`${API_URLS.TRANSACTIONS}/${txId}`, { method: "DELETE" });
      if (!response.ok) {
        return false;
      }
      return true;
    } catch (error) {
      tg.showAlert("Failed to delete transaction.");
      return false;
    }
  }

  function showDeleteConfirmation() {
    if (!state.editTransaction) return;
    const tx = state.editTransaction;
    const txId = tx.id;
    
    tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
      if (confirmed) {
        DOM.fullForm.saveBtn.disabled = true;
        DOM.fullForm.deleteBtn.disabled = true;

        // Optimistic Delete
        // 1. Close Screen
        showScreen("home-screen");
        
        // 2. Remove from State
        const index = state.transactions.findIndex(t => t.id === txId);
        if (index > -1) state.transactions.splice(index, 1);
        
        // 3. Remove from DOM
        const renderedItem = DOM.home.listContainer.querySelector(`[data-tx-id="${txId}"]`);
        let group = null;
        let nextSibling = null; 
        if (renderedItem) {
             group = renderedItem.closest(".transaction-group");
             nextSibling = renderedItem.nextElementSibling;
             renderedItem.remove();
             if (group && group.querySelectorAll(".expense-item").length === 0) group.remove();
        }

        // 4. Update Balance
        updateBalanceLocally(-tx.amount, tx.type);

        const success = await deleteTransaction(txId);
        
        if (!success) {
           // Revert
           if (index > -1) state.transactions.splice(index, 0, tx);
           // Restore DOM (simplest is to just reload or re-append, but let's try to be precise)
           // Actually, loadTransactions is safer and easier for revert
           await loadTransactions(false);
           await fetchAndRenderBalance();
           tg.showAlert("Delete failed. Transaction restored.");
        }
        
        DOM.fullForm.saveBtn.disabled = false;
        DOM.fullForm.deleteBtn.disabled = false;
        state.editTransaction = null;
      }
    });
  }

  async function _saveTransaction(txData, txId = null) {
    let url = API_URLS.TRANSACTIONS;
    let method = "POST";
    let body = txData;

    if (txId) {
      url = `${API_URLS.TRANSACTIONS}/${txId}`;
      method = "PATCH";
      body = { ...txData };
    }

    try {
      const response = await apiRequest(url, {
        method: method,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return null;
      }
      return await response.json();
    } catch (error) {
      tg.showAlert("An error occurred while saving.");
      return null;
    }
  }

  // --- OPTIMISTIC UI HELPERS ---

  function updateBalanceLocally(amount, type) {
      // Re-query to ensure we have the live element
      const balanceEl = document.getElementById("balance-amount") || DOM.home.balanceAmount;
      const currentBalanceText = balanceEl.textContent;
      const currentBalanceVal = parseFloat(currentBalanceText.replace(/[^0-9.-]+/g, "")) || 0;
      
      const change = type === "income" ? amount : -amount;
      const newBalance = currentBalanceVal + change;

      const sign = newBalance < 0 ? "-" : "";
      const absBalance = Math.abs(newBalance);
      const balanceFormatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const newBalanceText = `${sign}${state.currencySymbol}${balanceFormatter.format(absBalance)}`;
      
      // Update Text Immediately
      balanceEl.textContent = newBalanceText;

      // Add Flash Animation
      const container = balanceEl.closest(".total-container");
      if (container) {
          const classToAdd = newBalance > currentBalanceVal ? "balance-flash-positive" : "balance-flash-negative";
          container.classList.remove("balance-flash-positive", "balance-flash-negative");
          
          requestAnimationFrame(() => {
              container.classList.add(classToAdd);
          });
          container.addEventListener("animationend", () => container.classList.remove(classToAdd), { once: true });
      }
      return newBalanceText;
  }

  async function handleOptimisticAdd(txData, savePromise) {
      const tempId = Date.now();
      const list = DOM.home.listContainer;
      let newItem = null;
      let expectedBalanceText = null;

      try {
          // --- UI UPDATES (Synchronous) ---
          const categoryObj = state.categories.find(c => c.id === txData.category_id);
          
          // For display, if date is today (YYYY-MM-DD), use current detailed time to avoid UI jumping to 00:00
          let displayDate = txData.date;
          const todayStr = getLocalDateString(new Date());
          if (txData.date === todayStr) {
              displayDate = new Date().toISOString(); 
          }

          const tempTx = {
            ...txData,
            id: tempId,
            type: categoryObj ? categoryObj.type : (txData.amount < 0 ? "expense" : "income"), 
            category: categoryObj ? categoryObj.name : "Unknown",
            date: displayDate 
          };

          // 1. Update State
          // If currency differs, store original_amount for display logic
          if (txData.currency && txData.currency !== state.baseCurrencyCode) {
              tempTx.original_amount = txData.amount;
              
              if (state.rates && state.rates[state.baseCurrencyCode] && state.rates[txData.currency]) {
                   const rateSource = state.rates[txData.currency];
                   const rateTarget = state.rates[state.baseCurrencyCode];
                   const conversionRate = rateTarget / rateSource;
                   tempTx.amount = txData.amount * conversionRate;
              } else {
                   tempTx.amount = 0; 
              }
          }
          state.transactions.unshift(tempTx);
          state.offset += 1;

          // 2. Update DOM
          newItem = createTransactionElement(tempTx);
          newItem.classList.add("new-item-animation");
          newItem.addEventListener("animationend", () => newItem.classList.remove("new-item-animation"), { once: true });
          
          const placeholder = list.querySelector(".list-placeholder");
          if (placeholder) placeholder.remove();

          const txDate = parseDateFromUTC(tempTx.date);
          const dateHeaderStr = formatDateForTitle(txDate);
          
          // Helper to find sorted insertion point
          const allGroups = Array.from(list.querySelectorAll(".transaction-group"));
          let targetGroup = allGroups.find(g => g.dataset.date === dateHeaderStr);

          if (targetGroup) {
              // Existing group found - Prepend to it (after header)
               if (targetGroup.children.length > 1) {
                  targetGroup.insertBefore(newItem, targetGroup.children[1]);
               } else {
                  targetGroup.appendChild(newItem);
               }
          } else {
              // Create new group
              targetGroup = document.createElement("div");
              targetGroup.className = "transaction-group";
              targetGroup.dataset.date = dateHeaderStr;
              const headerEl = document.createElement("div");
              headerEl.className = "date-header";
              headerEl.textContent = dateHeaderStr;
              targetGroup.appendChild(headerEl);
              targetGroup.appendChild(newItem);

              // Find where to insert group (chronologically descending)
              let inserted = false;
              
              for (const group of allGroups) {
                  // Safe Strategy: Check the first transaction item in the group
                  const firstItem = group.querySelector(".transaction-item");
                  if (firstItem && firstItem.dataset.txId) {
                      const txIdInGroup = parseInt(firstItem.dataset.txId);
                      const txInGroup = state.transactions.find(t => t.id === txIdInGroup);
                      if (txInGroup) {
                          const groupDate = parseDateFromUTC(txInGroup.date);
                          if (groupDate < txDate) {
                              // Insert new group BEFORE the older group
                              list.insertBefore(targetGroup, group);
                              inserted = true;
                              break;
                          }
                      }
                  }
              }
              
              if (!inserted) {
                  // If not inserted before any, it's older than all -> Append
                  list.appendChild(targetGroup);
              }
          }

          // 3. Update Balance
          expectedBalanceText = updateBalanceLocally(tempTx.amount, tempTx.type);
          
          // Haptic Feedback (Immediate)
          tg.HapticFeedback.notificationOccurred("success");

          // 4. Close UI
          showScreen("home-screen", false);
          closeBottomSheet();
          
      } catch (uiError) {
          console.error("UI Update Failed", uiError);
          tg.showAlert("Something went wrong updating the interface."); 
          // Reload on UI failure
          await loadTransactions(false);
          await fetchAndRenderBalance();
          return;
      }

      // 5. Run API (Background Interaction)
      try {
          const savedTx = await savePromise;
          if (!savedTx) throw new Error("Save returned null");

          // Update State ID
          const index = state.transactions.findIndex(t => t.id === tempId);
          if (index !== -1) {
              state.transactions[index] = savedTx;
          }

          // Update DOM ID & Content
          const renderedItem = list.querySelector(`[data-tx-id="${tempId}"]`);
          if (renderedItem) {
              const newItemContent = createTransactionElement(savedTx);
              
              // 1. Update Content
              renderedItem.innerHTML = newItemContent.innerHTML;
              renderedItem.dataset.txId = savedTx.id;
              
              const newType = savedTx.type;
              const oldType = newType === "income" ? "expense" : "income";
              
              if (renderedItem.classList.contains(oldType)) {
                  renderedItem.classList.replace(oldType, newType);
              } else if (!renderedItem.classList.contains(newType)) {
                   renderedItem.classList.add(newType);
              }
          }
          
          // Re-sync balance but avoid flicker if it's stale
          // We trust our local update until next user action. 

      } catch (e) {
          console.error("Optimistic Add Failed (API)", e);
          
          // Revert State
          state.transactions = state.transactions.filter(t => t.id !== tempId);
          state.offset = Math.max(0, state.offset - 1);
          
          // Revert DOM
          const renderedItem = list.querySelector(`[data-tx-id="${tempId}"]`);
          if (renderedItem) {
              const group = renderedItem.closest(".transaction-group");
              renderedItem.remove();
              if (group && group.querySelectorAll(".expense-item").length === 0) group.remove();
          }

          // Revert Balance
          const categoryObj = state.categories.find(c => c.id === txData.category_id);
          const type = categoryObj ? categoryObj.type : (txData.amount < 0 ? "expense" : "income");
          updateBalanceLocally(txData.amount, type === "income" ? "expense" : "income"); // Inverse logic

          tg.showAlert("Failed to save transaction.");
      }
  }

  async function handleOptimisticEdit(txData, txId, savePromise) {
      const list = DOM.home.listContainer;
      const originalTx = state.transactions.find(t => t.id === txId);
      if (!originalTx) {
           // Should not happen, but fallback to normal await
           const saved = await savePromise;
           if (saved) {
               await loadTransactions(false);
               await fetchAndRenderBalance();
               showScreen("home-screen", true);
           }
           return;
      }

      const originalIndex = state.transactions.indexOf(originalTx);
      const categoryObj = state.categories.find(c => c.id === txData.category_id);
      
      // For display, if date is today (YYYY-MM-DD), use current detailed time
      let displayDate = txData.date;
      const todayStr = getLocalDateString(new Date());
      if (txData.date === todayStr) {
          // Keep original time if date hasn't changed, else use now
          if (getLocalDateString(parseDateFromUTC(originalTx.date)) === txData.date) {
               displayDate = originalTx.date;
          } else {
               displayDate = new Date().toISOString();
          }
      }

      const tempTx = {
        ...originalTx,
        category_id: txData.category_id,
        amount: txData.amount,
        currency: txData.currency,
        date: displayDate,
        note: txData.note,
        type: categoryObj ? categoryObj.type : (txData.amount < 0 ? "expense" : "income"),
        category: categoryObj ? categoryObj.name : "Unknown",
        original_amount: (txData.currency !== state.baseCurrencyCode) ? txData.amount : null 
      };
      
      // Currency conversion approx for display (if needed)
       if (txData.currency && txData.currency !== state.baseCurrencyCode) {
          if (state.rates && state.rates[state.baseCurrencyCode] && state.rates[txData.currency]) {
               const rateSource = state.rates[txData.currency];
               const rateTarget = state.rates[state.baseCurrencyCode];
               const conversionRate = rateTarget / rateSource;
               tempTx.amount = txData.amount * conversionRate;
          }
       } else {
           // Reset amount if same currency (case: switched back to base)
           tempTx.amount = txData.amount;
       }


      try {
          // 1. Update State
          state.transactions[originalIndex] = tempTx;

          // 2. Update DOM
          const renderedItem = list.querySelector(`[data-tx-id="${txId}"]`);
          if (renderedItem) {
              const newItemContent = createTransactionElement(tempTx);
              renderedItem.innerHTML = newItemContent.innerHTML;
              
              const newType = tempTx.type;
              renderedItem.classList.remove("income", "expense");
              renderedItem.classList.add(newType);
              
              // Move if date changed (Simplest: remove and re-insert, or just reload list if date changed)
              // For now, if date changed, we rely on full refresh or accept slight disorder until next load.
          }

          // 3. Update Balance
          // Revert old
          updateBalanceLocally(-originalTx.amount, originalTx.type); 
          // Apply new
          updateBalanceLocally(tempTx.amount, tempTx.type);

          tg.HapticFeedback.notificationOccurred("success");
          showScreen("home-screen", true);

      } catch (e) {
          console.error("Optimistic Edit UI Error", e);
          // Reload
          await loadTransactions(false);
          await fetchAndRenderBalance();
          return;
      }

      // 4. Run API
      try {
          const savedTx = await savePromise;
          if (!savedTx) throw new Error("Save returned null");

          // Sync State with Server Response (authoritative)
          state.transactions[originalIndex] = savedTx;
          
          // Sync DOM (Authoritative)
          const finalItem = list.querySelector(`[data-tx-id="${txId}"]`);
          if (finalItem) {
               const content = createTransactionElement(savedTx);
               finalItem.innerHTML = content.innerHTML;
          }
          // We likely don't need to re-update balance if our approx was close enough.
          
      } catch (e) {
          console.error("Optimistic Edit API Error", e);
          tg.showAlert("Failed to save changes. Reverting...");
          
          // Revert State
          state.transactions[originalIndex] = originalTx;
          
          // Revert DOM / Balance
          // Easiest is full reload
          await loadTransactions(false);
          await fetchAndRenderBalance();
      }
  }

  // Optimistic UI Update Logic
  async function handleSaveForm() {
    const categoryId = DOM.fullForm.categorySelect.value;
    const amountStr = DOM.fullForm.amountInput.value.replace(",", ".");
    const amount = parseFloat(amountStr);
    const dateInputVal = DOM.fullForm.dateInput.value;
    const currency = DOM.fullForm.currencySelect ? DOM.fullForm.currencySelect.value : "USD";
    const note = DOM.fullForm.noteInput.value.trim();

    if (!categoryId || isNaN(amount) || amount <= 0 || !dateInputVal) {
      tg.showAlert("Please fill all fields with valid data.");
      return;
    }
    DOM.fullForm.saveBtn.disabled = true;

    let dateToSend = dateInputVal;
    
    // Check if Edit Mode
    if (state.editTransaction) {
      const originalDateObj = parseDateFromUTC(state.editTransaction.date);
      const originalDateStr = getLocalDateString(originalDateObj);

      if (originalDateStr === dateInputVal) {
        dateToSend = state.editTransaction.date;
      }

      const txData = {
        category_id: parseInt(categoryId),
        amount: amount,
        currency: currency,
        date: dateToSend,
        note: note,
      };

      const txId = state.editTransaction.id;
      // Optimistic Edit
      await handleOptimisticEdit(txData, txId, _saveTransaction(txData, txId));
      
      DOM.fullForm.saveBtn.disabled = false;
      state.editTransaction = null;
    } else {
       // New Transaction - Optimistic
       const txData = {
          category_id: parseInt(categoryId),
          amount: amount,
          currency: currency,
          date: dateToSend,
          note: note
       };
       // We pass the promise, but we don't await it here because handleOptimisticAdd awaits it internally
       // while handling success/error. 
       // Note: handleOptimisticAdd is async, so we await it to catch any synchronous errors if any, 
       // but the API call is inside.
       await handleOptimisticAdd(txData, _saveTransaction(txData));
       DOM.fullForm.saveBtn.disabled = false;
    }
  }

  // --- SHEETS & MODALS ---
  function openBottomSheet(sheetElement) {
    if (!sheetElement) return;
    if (state.activeBottomSheet && state.activeBottomSheet !== sheetElement) {
      state.activeBottomSheet.style.transform = "translateY(100%)";
      setTimeout(() => state.activeBottomSheet.classList.add("hidden"), 300);
    }
    DOM.backdrop.classList.remove("hidden");
    sheetElement.classList.remove("hidden");
    document.body.classList.add("is-sheet-open");
    setTimeout(() => {
      DOM.backdrop.classList.add("shown");
      sheetElement.style.transform = "translateY(0)";
    }, 10);
    state.activeBottomSheet = sheetElement;
    tg.HapticFeedback.impactOccurred("light");
  }

  function closeBottomSheet() {
    if (!state.activeBottomSheet) return;
    document.body.classList.remove("is-sheet-open");
    DOM.backdrop.classList.remove("shown");
    state.activeBottomSheet.style.transform = "translateY(100%)";
    const sheetToHide = state.activeBottomSheet;
    state.activeBottomSheet = null;
    setTimeout(() => {
      sheetToHide.classList.add("hidden");
      if (!state.activeBottomSheet) DOM.backdrop.classList.add("hidden");
    }, 300);
  }

  function openQuickModal(category) {
    state.quickCategory = category;
    const { name: categoryName } = parseCategory(category.name);
    DOM.quickModal.title.textContent = categoryName;

    const savedCurr = localStorage.getItem("last_used_currency") || "USD";
    if (DOM.quickModal.currencySelect) {
      DOM.quickModal.currencySelect.value = savedCurr;
      if (DOM.quickModal.currencyLabel)
        DOM.quickModal.currencyLabel.textContent = CURRENCY_SYMBOLS[savedCurr] || savedCurr;
    }

    DOM.quickModal.amountInput.value = "";
    DOM.quickModal.noteInput.value = "";

    if (DOM.quickModal.noteToggleBtn && DOM.quickModal.noteInput) {
      DOM.quickModal.noteToggleBtn.classList.remove("hidden");
      DOM.quickModal.noteInput.classList.add("hidden");
      DOM.quickModal.noteInput.classList.remove("fade-in");
    }

    DOM.quickModal.saveBtn.className = "save-btn";
    if (category.type === "expense") {
      DOM.quickModal.saveBtn.classList.add("expense");
      DOM.quickModal.saveBtn.textContent = "Save Expense";
    } else {
      DOM.quickModal.saveBtn.classList.add("income");
      DOM.quickModal.saveBtn.textContent = "Save Income";
    }
    openBottomSheet(DOM.quickModal.sheet);
    setTimeout(() => DOM.quickModal.amountInput.focus(), 300);
  }

  async function saveQuickModal() {
    const amountStr = DOM.quickModal.amountInput.value.replace(",", ".");
    const amount = parseFloat(amountStr);
    const currency = DOM.quickModal.currencySelect ? DOM.quickModal.currencySelect.value : "USD";
    const note = DOM.quickModal.noteInput.value.trim();

    if (!state.quickCategory) return;
    if (isNaN(amount) || amount <= 0) {
      tg.showAlert("Please enter a valid amount.");
      return;
    }
    DOM.quickModal.saveBtn.disabled = true;

    const txData = {
      category_id: parseInt(state.quickCategory.id),
      amount: amount,
      date: getLocalDateString(new Date()),
      currency: currency,
      note: note,
    };
    
    await handleOptimisticAdd(txData, _saveTransaction(txData));
    DOM.quickModal.saveBtn.disabled = false;
  }

  function openDaySheet(date) {
    DOM.daySheet.title.textContent = formatDateForTitle(date);
    const selectedDateString = getLocalDateString(date);
    const dayTransactions = state.transactions.filter((tx) => {
      const txDate = parseDateFromUTC(tx.date);
      return getLocalDateString(txDate) === selectedDateString;
    });

    DOM.daySheet.list.innerHTML = "";
    if (dayTransactions.length === 0) {
      DOM.daySheet.list.innerHTML = "<p class='list-placeholder'>No transactions on this day.</p>";
    } else {
      dayTransactions.forEach((tx) => DOM.daySheet.list.appendChild(createTransactionElement(tx)));
    }
    DOM.daySheet.contentWrapper.scrollTop = 0;
    openBottomSheet(DOM.daySheet.sheet);
  }

  function setupSheetDrag(sheet, header, content, closeFn) {
    let isDragging = false;
    let startY = 0;
    let currentY = 0;

    const handleTouchMove = (e) => {
      if (!isDragging) return;
      let diffY = e.touches[0].clientY - startY;
      if (diffY > 0) {
        e.preventDefault();
        currentY = diffY;
        sheet.style.transform = `translateY(${diffY}px)`;
      }
    };
    const handleTouchEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      sheet.style.transition = "transform 0.3s ease-out";
      if (currentY > 100) closeFn();
      else sheet.style.transform = "translateY(0)";
      currentY = 0;
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };

    header.addEventListener(
      "touchstart",
      (e) => {
        if (content && content.scrollTop > 0) {
          isDragging = false;
          return;
        }
        isDragging = true;
        startY = e.touches[0].clientY;
        sheet.style.transition = "none";
        document.addEventListener("touchmove", handleTouchMove, { passive: false });
        document.addEventListener("touchend", handleTouchEnd);
      },
      { passive: true }
    );
  }

  function openSummarySheet(type, amount) {
    let title = "Total";
    let cssClass = "net";
    let sign = amount > 0 ? "+" : amount < 0 ? "-" : "";

    if (type === "income") {
      title = "Total Income";
      cssClass = "income";
      sign = "+";
    } else if (type === "expense") {
      title = "Total Expense";
      cssClass = "expense";
      sign = "-";
    } else {
      title = "Net Total";
      cssClass = amount >= 0 ? "net positive" : "net negative";
    }

    DOM.summarySheet.title.textContent = title;
    DOM.summarySheet.currency.textContent = "";
    DOM.summarySheet.amountInput.value = `${sign}${state.currencySymbol}${preciseNumberFormatter.format(
      Math.abs(amount)
    )}`;
    DOM.summarySheet.amountInput.className = cssClass;
    tg.HapticFeedback.impactOccurred("medium");
    openBottomSheet(DOM.summarySheet.sheet);
  }

  // --- SWIPE LOGIC ---
  let swipeStartX = 0;
  let swipeStartY = 0;
  let currentSwipeElement = null;
  let isSwiping = false;
  const SWIPE_DELETE_BG_WIDTH = 90;
  const SWIPE_THRESHOLD = -80;

  function handleSwipeStart(e) {
    const target = e.target.closest(".expense-item") || e.target.closest(".category-item-wrapper");
    if (e.target.closest(".edit-btn")) return;
    if (target && target.classList.contains("category-item-wrapper") && target.dataset.isDefault === "true") return;

    if (!target) return;

    currentSwipeElement = target;
    // Activate swipe background
    target.classList.add("swiping-active");

    isSwiping = false;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;

    const content = target.querySelector(".expense-item-content") || target.querySelector(".category-item-content");
    if (content) {
      content.style.transition = "none";
    }
  }

  function handleSwipeMove(e) {
    if (!currentSwipeElement) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - swipeStartX;
    const diffY = currentY - swipeStartY;

    if (!isSwiping) {
      if (Math.abs(diffY) > Math.abs(diffX)) {
        currentSwipeElement = null;
        return;
      }
      if (Math.abs(diffX) > 5) {
        isSwiping = true;
      }
    }

    if (isSwiping) {
      if (e.cancelable) e.preventDefault();

      const content =
        currentSwipeElement.querySelector(".expense-item-content") ||
        currentSwipeElement.querySelector(".category-item-content");

      if (!content) return;

      let moveX = diffX > 0 ? 0 : diffX;
      if (moveX < -SWIPE_DELETE_BG_WIDTH) {
        moveX = -SWIPE_DELETE_BG_WIDTH - Math.pow(-moveX - SWIPE_DELETE_BG_WIDTH, 0.7);
      }

      content.style.transform = `translateX(${moveX}px)`;
    }
  }

  function handleSwipeEnd(e) {
    if (!currentSwipeElement) return;

    const content =
      currentSwipeElement.querySelector(".expense-item-content") ||
      currentSwipeElement.querySelector(".category-item-content");

    if (content) content.style.transition = "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)";

    const currentX = e.changedTouches[0].clientX;
    const diffX = currentX - swipeStartX;

    if (isSwiping && diffX < SWIPE_THRESHOLD) {
      // Swipe Successful
      content.style.transform = `translateX(-${SWIPE_DELETE_BG_WIDTH}px)`;
      tg.HapticFeedback.impactOccurred("medium");

      if (currentSwipeElement.classList.contains("category-item-wrapper")) {
        handleDeleteCategory(currentSwipeElement.dataset.id, content);
      } else {
        handleDeleteSwipe(currentSwipeElement, content);
      }
    } else {
      // Swipe Canceled
      content.style.transform = "translateX(0)";
      currentSwipeElement.classList.remove("swiping-active");
    }

    currentSwipeElement = null;
    isSwiping = false;
  }

  function handleDeleteSwipe(element, content) {
    const editBtn = element.querySelector(".edit-btn");
    const txId = parseInt(editBtn.dataset.txId, 10);
    const tx = state.transactions.find(t => t.id === txId);

    tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
      if (confirmed) {
        tg.HapticFeedback.notificationOccurred("success");

        // 1. Visual Collapse
        element.style.height = element.offsetHeight + "px";
        
        // Optimistic: Update Balance immediately
        if (tx) {
             updateBalanceLocally(-tx.amount, tx.type);
        }

        requestAnimationFrame(() => {
          element.classList.add("deleting");
          element.style.height = "0px";
          element.style.margin = "0px";
          element.style.padding = "0px";
        });

        element.addEventListener(
          "transitionend",
          async () => {
             // 2. Remove from DOM & State Optimistically
             const group = element.closest(".transaction-group");
             element.remove();
             if (group && group.querySelectorAll(".expense-item").length === 0) group.remove();
             
             const index = state.transactions.findIndex(t => t.id === txId);
             if (index > -1) state.transactions.splice(index, 1);

             // 3. API Call
             const success = await deleteTransaction(txId);

             if (!success) {
                  // Revert
                  tg.showAlert("Could not delete. Restoring...");
                  // Since we removed it, simplest is to reload
                  await loadTransactions(false);
                  await fetchAndRenderBalance();
             }
          },
          { once: true }
        );
      } else {
        // Canceled
        content.style.transform = "translateX(0)";
        element.classList.remove("swiping-active");
      }
    });
  }

  // --- ANALYTICS ---
  async function loadAnalyticsPage() {
    if (DOM.analytics.summaryPane.classList.contains("hidden")) await loadCalendarData();
    else await loadSummaryData();
  }

  async function loadSummaryData() {
    if (state.isLoading) return;
    state.isLoading = true;
    DOM.analytics.summaryList.innerHTML = `<p class="list-placeholder">Loading summary...</p>`;
    if (state.chart) state.chart.destroy();
    DOM.analytics.doughnutChartCanvas.classList.add("hidden");

    const isExpense = state.summaryType === "expense";
    const palette = isExpense
      ? ["#FFB6C1", "#FFDAB9", "#FFFFE0", "#98FB98", "#AFEEEE", "#ADD8E6", "#E6E6FA", "#FADADD", "#FDE6D2", "#FBF0D0"]
      : ["#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#14532d", "#064e3b"];

    try {
      const url = new URL(API_URLS.ANALYTICS_SUMMARY, window.location.origin);
      url.searchParams.append("type", state.summaryType);
      url.searchParams.append("range", state.summaryRange);

      const response = await apiRequest(url.toString());
      if (!response.ok) throw new Error("Failed to load summary");
      const data = await response.json();

      DOM.analytics.summaryList.innerHTML = "";
      if (data.length === 0) {
        DOM.analytics.summaryList.innerHTML = `<p class="list-placeholder">No ${state.summaryType}s found for this period.</p>`;
        return;
      }

      DOM.analytics.doughnutChartCanvas.classList.remove("hidden");
      const labels = data.map((item) => {
        const rawName = parseCategory(item.category).name;
        return rawName.length > 15 ? rawName.substring(0, 15) + "..." : rawName;
      });
      const totals = data.map((item) => item.total);

      const totalSum = totals.reduce((a, b) => a + b, 0);
      const absTotal = Math.abs(totalSum);
      let compactTotal;
      if (absTotal >= 1000000) compactTotal = (absTotal / 1000000).toFixed(2) + "M";
      else if (absTotal >= 10000) compactTotal = (absTotal / 1000).toFixed(0) + "K";
      else if (absTotal >= 1000) compactTotal = (absTotal / 1000).toFixed(1) + "K";
      else compactTotal = absTotal.toFixed(2);

      const totalLabel = isExpense ? "Expenses" : "Income";
      const totalSign = isExpense ? "-" : "+";
      const totalColor = isExpense ? "#ef4444" : "#22c55e";
      const formattedCenterText = `${totalSign}${state.currencySymbol}${compactTotal}`;

      data.forEach((item) => {
        const itemEl = document.createElement("div");
        itemEl.className = "summary-list-item";
        const { icon, name } = parseCategory(item.category);
        let categoryDisplay;
        if (icon) {
          categoryDisplay = `${icon} ${name}`;
        } else if (defaultEmojis[name]) {
          categoryDisplay = `${defaultEmojis[name]} ${name}`;
        } else {
          const defaultIcon = isExpense ? defaultIconExpense : defaultIconIncome;
          categoryDisplay = `${defaultIcon} ${name}`;
        }
        itemEl.innerHTML = `
            <span class="category">${categoryDisplay}</span>
            <span class="amount" style="color: var(--color-${isExpense ? "expense" : "income"})">
              ${isExpense ? "-" : "+"}${formatCurrency(item.total)}
            </span>`;
        DOM.analytics.summaryList.appendChild(itemEl);
      });

      const centerTextPlugin = {
        id: "centerText",
        beforeDraw: (chart) => {
          const {
            ctx,
            chartArea: { top, bottom, left, right },
          } = chart;
          const centerX = (left + right) / 2;
          const centerY = (top + bottom) / 2;
          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const donutHeight = bottom - top;
          ctx.font = `500 ${(donutHeight / 320).toFixed(2)}em sans-serif`;
          ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--tg-theme-hint-color");
          ctx.fillText(totalLabel, centerX, centerY - donutHeight * 0.04);
          ctx.font = `bold ${(donutHeight / 200).toFixed(2)}em sans-serif`;
          ctx.fillStyle = totalColor;
          ctx.fillText(formattedCenterText, centerX, centerY + donutHeight * 0.04);
          ctx.restore();
        },
      };

      state.chart = new Chart(DOM.analytics.doughnutChartCanvas, {
        type: "doughnut",
        data: {
          labels: labels,
          datasets: [{ data: totals, backgroundColor: palette, borderWidth: 0 }],
        },
        options: {
          responsive: true,
          cutout: "50%",
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: {
                boxWidth: 12,
                padding: 15,
                usePointStyle: true,
                pointStyle: "rectRounded",
                color: getComputedStyle(document.body).getPropertyValue("--tg-theme-text-color"),
              },
            },
          },
        },
        plugins: [centerTextPlugin],
      });
    } catch (error) {
      renderErrorState(DOM.analytics.summaryList, () => loadSummaryData(), "Failed to load summary data.");
    } finally {
      state.isLoading = false;
    }
  }

  function populateDatePickers() {
    const currentMonth = state.analyticsDate.getMonth();
    const currentYear = state.analyticsDate.getFullYear();
    DOM.calendar.monthSelect.innerHTML = "";
    [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ].forEach((m, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = m;
      if (i === currentMonth) opt.selected = true;
      DOM.calendar.monthSelect.appendChild(opt);
    });
    DOM.calendar.yearSelect.innerHTML = "";
    for (let y = currentYear - 5; y <= currentYear + 1; y++) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      if (y === currentYear) opt.selected = true;
      DOM.calendar.yearSelect.appendChild(opt);
    }
  }

  async function loadCalendarData() {
    const year = state.analyticsDate.getFullYear();
    const month = state.analyticsDate.getMonth() + 1;
    populateDatePickers();
    DOM.calendar.summaryIncome.textContent = "...";
    DOM.calendar.container.innerHTML = '<p class="list-placeholder">Loading calendar...</p>';

    try {
      const response = await apiRequest(`${API_URLS.ANALYTICS_CALENDAR}?month=${month}&year=${year}`);
      if (!response.ok) throw new Error("Load failed");
      const data = await response.json();

      state.calendarSummary = data.month_summary;
      DOM.calendar.summaryIncome.textContent = formatCurrencyForSummary(data.month_summary.income);
      DOM.calendar.summaryExpense.textContent = formatCurrencyForSummary(data.month_summary.expense * -1);
      DOM.calendar.summaryNet.textContent = formatCurrencyForSummary(data.month_summary.net);
      DOM.calendar.summaryNet.style.color =
        data.month_summary.net >= 0 ? "var(--color-income)" : "var(--color-expense)";

      DOM.calendar.container.innerHTML = "";
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      const todayString = new Date().toDateString();

      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((d) => {
        const el = document.createElement("div");
        el.className = "calendar-day-header";
        el.textContent = d;
        DOM.calendar.container.appendChild(el);
      });
      const startDayOfWeek = (firstDay.getDay() + 6) % 7;
      for (let i = 0; i < startDayOfWeek; i++) {
        const el = document.createElement("div");
        el.className = "calendar-day is-other-month";
        DOM.calendar.container.appendChild(el);
      }
      for (let day = 1; day <= lastDay.getDate(); day++) {
        const current = new Date(year, month - 1, day);
        const dayEl = document.createElement("div");
        dayEl.className = "calendar-day";
        if (current.toDateString() === todayString) dayEl.classList.add("is-today");

        const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        let markers = "";
        if (data.days[dayKey]) {
          if (data.days[dayKey].income > 0)
            markers += `<span class="income">${formatForDayMarker(data.days[dayKey].income)}</span>`;
          if (data.days[dayKey].expense > 0)
            markers += `<span class="expense">${formatForDayMarker(data.days[dayKey].expense * -1)}</span>`;
        }
        dayEl.innerHTML = `<div class="day-number">${day}</div><div class="day-marker">${markers}</div>`;
        dayEl.addEventListener("click", () => openDaySheet(current));
        DOM.calendar.container.appendChild(dayEl);
      }
    } catch (error) {
      renderErrorState(DOM.calendar.container, () => loadCalendarData(), "Failed to load calendar data.");
    }
  }

  // --- AI ADVISOR ---
  async function fetchAiData(promptType, title) {
    tg.HapticFeedback.impactOccurred("medium");
    DOM.ai.featuresList.classList.add("hidden");
    DOM.ai.resultContainer.classList.remove("hidden");
    DOM.ai.resultTitle.textContent = title;
    DOM.ai.resultBody.textContent = "Thinking...";

    try {
      const url = `${API_URLS.AI_ADVICE}?range=${state.aiRange}&prompt_type=${promptType}`;
      const response = await apiRequest(url, { method: "POST" });
      if (!response.ok) throw new Error("AI Error");
      const data = await response.json();
      DOM.ai.resultBody.textContent = data.advice;
    } catch (error) {
      DOM.ai.resultBody.innerHTML = `
        <div class="list-placeholder" style="padding: 20px 0;">
            <span class="icon">☁️</span>
            <h3 style="font-size: 1.1rem;">Couldn't Connect</h3>
            <p>Failed to get response from AI.</p>
            <button class="placeholder-btn">Retry</button>
        </div>`;
      const retryBtn = DOM.ai.resultBody.querySelector(".placeholder-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          tg.HapticFeedback.impactOccurred("light");
          fetchAiData(promptType, title);
        });
      }
    }
  }

  // --- SETTINGS ---
  async function handleResetData() {
    DOM.settings.resetDataBtn.disabled = true;
    DOM.settings.resetDataBtn.textContent = "Resetting...";
    try {
      const response = await apiRequest(API_URLS.USER_RESET, { method: "DELETE" });
      if (!response.ok) throw new Error("Reset failed");
      tg.HapticFeedback.notificationOccurred("success");
      await loadTransactions();
      await loadAllCategories();
      await fetchAndRenderBalance();
      showScreen("home-screen");
      tg.showPopup({
        title: "Data Reset",
        message: "Your account has been successfully reset.",
        buttons: [{ type: "ok" }],
      });
    } catch (error) {
      tg.showAlert("Failed to reset data.");
    } finally {
      DOM.settings.resetDataBtn.disabled = false;
      DOM.settings.resetDataBtn.textContent = "Reset All Data";
    }
  }

  // Category List Renderer
  function loadCategoriesScreen() {
    DOM.categories.list.innerHTML = "";
    const categories = state.categories.filter((c) => c.type === state.categoryType);
    if (categories.length === 0) {
      DOM.categories.list.innerHTML = `
        <div class="list-placeholder" style="padding: 40px 20px;">
            <span class="icon">🏷️</span>
            <h3>No Categories Yet</h3>
            <p>Use the form above to add your first ${state.categoryType} category.</p>
        </div>`;
      return;
    }
    categories.forEach((cat) => {
      const item = document.createElement("div");
      item.className = "category-item-wrapper";
      item.dataset.id = cat.id;
      item.dataset.isDefault = cat.user_id === null;

      const { icon, name } = parseCategory(cat.name);
      let displayName = name;
      if (!icon && defaultEmojis[name]) displayName = `${defaultEmojis[name]} ${name}`;
      else if (icon) displayName = `${icon} ${name}`;
      else {
        const defIcon = state.categoryType === "income" ? defaultIconIncome : defaultIconExpense;
        displayName = `${defIcon} ${name}`;
      }

      let rightSideHtml = "";
      if (cat.user_id === null) {
        rightSideHtml = `<span class="default-badge">Default</span>`;
      } else {
        rightSideHtml = `<span class="category-chevron">›</span>`;
      }

      const trashIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clip-rule="evenodd" /></svg>`;

      item.innerHTML = `
            <div class="expense-item-delete-bg">
                ${trashIconSvg}
            </div>
            <div class="category-item-content">
                <span class="cat-name">${displayName}</span>
                ${rightSideHtml}
            </div>
        `;

      if (cat.user_id !== null) {
        item.addEventListener("click", () => {
          if (!isSwiping) {
            tg.HapticFeedback.impactOccurred("light");
            openEditCategoryScreen(cat);
          }
        });
      }

      DOM.categories.list.appendChild(item);
    });
  }

  function openEditCategoryScreen(cat) {
    state.categoryBeingEdited = cat;
    const { icon, name } = parseCategory(cat.name);
    DOM.editCategory.nameInput.value = name;
    DOM.editCategory.iconInput.value = icon || "";
    showScreen("edit-category-screen");
  }

  async function saveEditedCategory() {
    if (!state.categoryBeingEdited) return;

    const newName = DOM.editCategory.nameInput.value.trim();
    const newIcon = DOM.editCategory.iconInput.value.trim();

    if (!newName) {
      tg.showAlert("Name is required");
      return;
    }

    const fullName = newIcon ? `${newIcon} ${newName}` : newName;
    const catId = state.categoryBeingEdited.id;

    DOM.editCategory.saveBtn.disabled = true;

    try {
      const response = await apiRequest(`${API_URLS.CATEGORIES}/${catId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: fullName, type: state.categoryBeingEdited.type }),
      });

      if (!response.ok) throw new Error("Update failed");

      tg.HapticFeedback.notificationOccurred("success");
      await loadAllCategories();
      await loadTransactions();
      showScreen("categories-screen");
    } catch (e) {
      tg.showAlert("Failed to update category");
      console.error(e);
    } finally {
      DOM.editCategory.saveBtn.disabled = false;
    }
  }

  async function handleAddCategory() {
    const icon = DOM.categories.newIconInput.value.trim();
    const name = DOM.categories.newNameInput.value.trim();
    if (!name) {
      tg.showAlert("Please enter a category name.");
      return;
    }
    const fullName = icon ? `${icon} ${name}` : name;
    tg.HapticFeedback.impactOccurred("light");
    DOM.categories.addBtn.disabled = true;
    try {
      const response = await apiRequest(API_URLS.CATEGORIES, {
        method: "POST",
        body: JSON.stringify({ name: fullName, type: state.categoryType }),
      });
      if (!response.ok) throw new Error("Add failed");
      DOM.categories.newIconInput.value = "";
      DOM.categories.newNameInput.value = "";
      await loadAllCategories();
      loadCategoriesScreen();
    } catch (e) {
    } finally {
      DOM.categories.addBtn.disabled = false;
    }
  }

  async function handleDeleteCategory(categoryId, swipeElement = null) {
    let transactionCount = 0;
    let message = "Are you sure you want to delete this category?";

    try {
      const check = await apiRequest(`${API_URLS.CATEGORIES}/${categoryId}/check`);
      if (check.ok) {
        const data = await check.json();
        transactionCount = data.transaction_count;
      }
    } catch (e) {
      tg.showAlert("Failed to check category.");
      if (swipeElement) {
        swipeElement.style.transform = "translateX(0)";
        swipeElement.closest(".category-item-wrapper").classList.remove("swiping-active");
      }
      return;
    }

    if (transactionCount > 0) {
      const txWord = transactionCount === 1 ? "transaction" : "transactions";
      message = `This category is linked to ${transactionCount} ${txWord}.\n\nIt will be hidden from the list, but your past history will remain safe.`;
    }

    tg.showConfirm(message, async (confirmed) => {
      if (confirmed) {
        try {
          if (swipeElement) {
            const wrapper = swipeElement.closest(".category-item-wrapper");
            if (wrapper) {
              wrapper.style.height = wrapper.offsetHeight + "px";
              wrapper.offsetHeight; // Force reflow
              wrapper.style.transition = "all 0.3s ease";
              wrapper.style.height = "0px";
              wrapper.style.opacity = "0";
              wrapper.style.margin = "0";
            }
          }

          const deleteResponse = await apiRequest(`${API_URLS.CATEGORIES}/${categoryId}`, { method: "DELETE" });
          if (!deleteResponse.ok) throw new Error("Delete failed");

          tg.HapticFeedback.notificationOccurred("success");

          if (swipeElement) await new Promise((r) => setTimeout(r, 300));

          if (swipeElement) {
            const wrapper = swipeElement.closest(".category-item-wrapper");
            if (wrapper) wrapper.remove();
          } else {
            showScreen("categories-screen");
            loadCategoriesScreen();
          }

          // Update categories state
          await loadAllCategories();
          await fetchAndRenderBalance();
        } catch (e) {
          console.error(e);
          tg.showAlert("Error deleting category");
        }
      } else {
        // Canceled
        if (swipeElement) {
          swipeElement.style.transform = "translateX(0)";
          swipeElement.closest(".category-item-wrapper").classList.remove("swiping-active");
        }
      }
    });
  }

  function handleScroll() {
    if (state.activeBottomSheet || document.getElementById("home-screen").classList.contains("hidden")) return;
    const scrollPosition = window.innerHeight + window.scrollY;
    const bodyHeight = document.body.offsetHeight;
    if (scrollPosition >= bodyHeight - 1000) {
      if (!state.isLoadingMore && !state.isAllLoaded) {
        loadTransactions(true);
      }
    }
  }

  async function fetchUserProfile() {
    try {
      const response = await apiRequest(API_URLS.USER_PROFILE);
      if (response.ok) {
        const data = await response.json();
        if (data.base_currency) {
          state.baseCurrencyCode = data.base_currency;
          state.currencySymbol = CURRENCY_SYMBOLS[data.base_currency] || "$";
          DOM.settings.currencySelect.value = data.base_currency;
        }
      }
    } catch (e) {
      console.error("Failed to load user profile", e);
    }
  }

  // --- INITIALIZATION ---
  function init() {
    if (tg.platform === "android" || tg.platform === "android_x") document.body.classList.add("platform-android");
    const applyTheme = () => {
      if (tg.colorScheme === "dark") {
        tg.setHeaderColor("#1C1C1E");
        tg.setBackgroundColor("#1C1C1E");
      } else {
        tg.setHeaderColor("#FFFFFF");
        tg.setBackgroundColor("#FFFFFF");
      }
    };
    applyTheme();
    tg.onEvent("themeChanged", applyTheme);

    window.addEventListener("scroll", handleScroll);

    setupCurrencyPicker(DOM.fullForm.currencySelect, DOM.fullForm.currencyLabel);
    setupCurrencyPicker(DOM.quickModal.currencySelect, DOM.quickModal.currencyLabel);

    DOM.tabs.home.addEventListener("click", () => {
      showScreen("home-screen");
      tg.HapticFeedback.impactOccurred("light");
    });
    DOM.tabs.analytics.addEventListener("click", () => {
      showScreen("analytics-screen");
      tg.HapticFeedback.impactOccurred("light");
    });
    DOM.tabs.ai.addEventListener("click", () => {
      showScreen("ai-screen");
      tg.HapticFeedback.impactOccurred("light");
    });
    DOM.tabs.settings.addEventListener("click", () => {
      showScreen("settings-screen");
      tg.HapticFeedback.impactOccurred("light");
    });
    DOM.tabs.add.addEventListener("click", () => {
      openAddScreen();
      tg.HapticFeedback.impactOccurred("medium");
    });

    DOM.fullForm.cancelBtn.addEventListener("click", () => {
      showScreen(state.lastActiveScreen, true);
      tg.HapticFeedback.impactOccurred("light");
    });
    DOM.fullForm.saveBtn.addEventListener("click", handleSaveForm);
    DOM.fullForm.deleteBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("heavy");
      showDeleteConfirmation();
    });
    DOM.quickAdd.manualExpense.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("medium");
      openFullForm("expense");
    });
    DOM.quickAdd.manualIncome.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("medium");
      openFullForm("income");
    });
    DOM.quickAdd.manageBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      showScreen("categories-screen");
    });
    DOM.quickModal.saveBtn.addEventListener("click", saveQuickModal);
    DOM.backdrop.addEventListener("click", closeBottomSheet);

    setupSheetDrag(DOM.daySheet.sheet, DOM.daySheet.header, DOM.daySheet.contentWrapper, closeBottomSheet);
    setupSheetDrag(DOM.quickModal.sheet, DOM.quickModal.header, null, closeBottomSheet);
    setupSheetDrag(DOM.summarySheet.sheet, DOM.summarySheet.header, null, closeBottomSheet);

    // List Swipe Listeners
    [DOM.home.listContainer, DOM.daySheet.list, DOM.categories.list].forEach((list) => {
      list.addEventListener("touchstart", handleSwipeStart, { passive: true });
      list.addEventListener("touchmove", handleSwipeMove, { passive: false });
      list.addEventListener("touchend", handleSwipeEnd);
    });

    DOM.analytics.segBtnSummary.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      DOM.analytics.summaryPane.classList.remove("hidden");
      DOM.analytics.calendarPane.classList.add("hidden");
      DOM.analytics.segBtnSummary.classList.add("active");
      DOM.analytics.segBtnCalendar.classList.remove("active");
      loadAnalyticsPage();
      sessionStorage.setItem("lastAnalyticsTab", "summary");
    });
    DOM.analytics.segBtnCalendar.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      DOM.analytics.summaryPane.classList.add("hidden");
      DOM.analytics.calendarPane.classList.remove("hidden");
      DOM.analytics.segBtnSummary.classList.remove("active");
      DOM.analytics.segBtnCalendar.classList.add("active");
      sessionStorage.setItem("lastAnalyticsTab", "calendar");
      loadAnalyticsPage();
    });
    DOM.analytics.summaryTypeFilter.addEventListener("click", (e) => {
      const t = e.target.closest(".seg-button");
      if (!t) return;
      tg.HapticFeedback.impactOccurred("light");
      DOM.analytics.summaryTypeFilter.querySelectorAll(".seg-button").forEach((b) => b.classList.remove("active"));
      t.classList.add("active");
      state.summaryType = t.dataset.type;
      loadSummaryData();
    });
    DOM.analytics.summaryRangeFilter.addEventListener("click", (e) => {
      const t = e.target.closest(".seg-button");
      if (!t) return;
      tg.HapticFeedback.impactOccurred("light");
      DOM.analytics.summaryRangeFilter.querySelectorAll(".seg-button").forEach((b) => b.classList.remove("active"));
      t.classList.add("active");
      state.summaryRange = t.dataset.range;
      loadSummaryData();
    });

    DOM.calendar.prevMonthBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      state.analyticsDate.setMonth(state.analyticsDate.getMonth() - 1);
      loadCalendarData();
    });
    DOM.calendar.nextMonthBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      state.analyticsDate.setMonth(state.analyticsDate.getMonth() + 1);
      loadCalendarData();
    });

    DOM.calendar.monthSelect.addEventListener("change", (e) => {
      tg.HapticFeedback.impactOccurred("light");
      state.analyticsDate.setMonth(parseInt(e.target.value));
      loadCalendarData();
    });

    DOM.calendar.yearSelect.addEventListener("change", (e) => {
      tg.HapticFeedback.impactOccurred("light");
      state.analyticsDate.setFullYear(parseInt(e.target.value));
      loadCalendarData();
    });

    DOM.calendar.boxIncome.addEventListener("click", () => openSummarySheet("income", state.calendarSummary.income));
    DOM.calendar.boxExpense.addEventListener("click", () =>
      openSummarySheet("expense", state.calendarSummary.expense * -1)
    );
    DOM.calendar.boxNet.addEventListener("click", () => openSummarySheet("net", state.calendarSummary.net));

    DOM.ai.dateFilter.addEventListener("click", (e) => {
      const target = e.target.closest(".seg-button");
      if (!target) return;
      tg.HapticFeedback.impactOccurred("light");
      DOM.ai.dateFilter.querySelectorAll(".seg-button").forEach((btn) => btn.classList.remove("active"));
      target.classList.add("active");

      const range = target.dataset.range;
      state.aiRange = range;
      updateAiDescriptions(range);
    });

    DOM.ai.btnAdvice.addEventListener("click", () => fetchAiData("advice", "Here's your Advice"));
    DOM.ai.btnSummary.addEventListener("click", () => {
      const rangeText = state.aiRange.charAt(0).toUpperCase() + state.aiRange.slice(1);
      fetchAiData("summary", `Here's your ${rangeText} Summary`);
    });
    DOM.ai.btnAnomaly.addEventListener("click", () => {
      const rangeText = state.aiRange.charAt(0).toUpperCase() + state.aiRange.slice(1);
      fetchAiData("anomaly", `Largest Expense This ${rangeText}`);
    });
    DOM.ai.resultBackBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      DOM.ai.resultContainer.classList.add("hidden");
      DOM.ai.featuresList.classList.remove("hidden");
    });

    if (DOM.quickModal.noteToggleBtn) {
      DOM.quickModal.noteToggleBtn.addEventListener("click", () => {
        tg.HapticFeedback.impactOccurred("light");
        DOM.quickModal.noteToggleBtn.classList.add("hidden");
        DOM.quickModal.noteInput.classList.remove("hidden");
        DOM.quickModal.noteInput.classList.add("fade-in");
        DOM.quickModal.noteInput.focus({ preventScroll: true });
      });
    }

    DOM.settings.currencySelect.addEventListener("change", async (e) => {
      tg.HapticFeedback.impactOccurred("medium");
      const newCurrency = e.target.value;
      tg.MainButton.showProgress();
      try {
        const response = await apiRequest(API_URLS.USER_SETTINGS_CURRENCY, {
          method: "POST",
          body: JSON.stringify({ base_currency: newCurrency }),
        });
        if (!response.ok) throw new Error("Failed to update currency");
        state.baseCurrencyCode = newCurrency;
        state.currencySymbol = CURRENCY_SYMBOLS[newCurrency] || "$";
        tg.CloudStorage.setItem("currency_symbol", state.currencySymbol);
        await loadTransactions(false);
        await fetchAndRenderBalance();
        tg.showPopup({
          title: "Currency Updated",
          message: `All transactions recalculated to ${newCurrency}.`,
          buttons: [{ type: "ok" }],
        });
      } catch (error) {
        console.error(error);
        tg.showAlert("Failed to update currency. Please try again.");
      } finally {
        tg.MainButton.hideProgress();
      }
    });

    DOM.settings.resetDataBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("heavy");
      tg.showConfirm("Are you sure? All your transactions and custom categories will be deleted.", (firstConfirm) => {
        if (firstConfirm) {
          tg.showConfirm("Are you 100% sure? This action CANNOT be undone!", (secondConfirm) => {
            if (secondConfirm) {
              handleResetData();
            }
          });
        }
      });
    });

    document.body.addEventListener("click", handleEditTransactionClick);
    DOM.categories.backBtn.addEventListener("click", () => {
      showScreen(state.lastActiveScreen);
      tg.HapticFeedback.impactOccurred("light");
    });
    DOM.categories.segBtnExpense.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      state.categoryType = "expense";
      DOM.categories.segBtnExpense.classList.add("active");
      DOM.categories.segBtnIncome.classList.remove("active");
      loadCategoriesScreen();
    });
    DOM.categories.segBtnIncome.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      state.categoryType = "income";
      DOM.categories.segBtnIncome.classList.add("active");
      DOM.categories.segBtnExpense.classList.remove("active");
      loadCategoriesScreen();
    });
    DOM.categories.addBtn.addEventListener("click", handleAddCategory);

    DOM.editCategory.saveBtn.addEventListener("click", saveEditedCategory);
    DOM.editCategory.deleteBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("heavy");
      if (state.categoryBeingEdited) handleDeleteCategory(state.categoryBeingEdited.id);
    });
    DOM.editCategory.backBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      showScreen("categories-screen");
    });

    document.addEventListener("focusin", (e) => {
      const tag = e.target.tagName;
      const type = e.target.getAttribute("type");
      const keyboardTypes = ["text", "number", "tel", "email", "password", "search", "url"];

      if (tag === "TEXTAREA") {
        document.body.classList.add("keyboard-open");
        return;
      }
      if (tag === "INPUT" && keyboardTypes.includes(type)) {
        document.body.classList.add("keyboard-open");
      }
    });

    document.addEventListener("focusout", (e) => {
      setTimeout(() => {
        const active = document.activeElement;
        const tag = active ? active.tagName : null;
        const type = active ? active.getAttribute("type") : null;
        const keyboardTypes = ["text", "number", "tel", "email", "password", "search", "url"];
        const isKeyboardInput = tag === "TEXTAREA" || (tag === "INPUT" && keyboardTypes.includes(type));

        if (!isKeyboardInput) {
          document.body.classList.remove("keyboard-open");
        }
      }, 50);
    });

    if (DOM.fullForm.noteInput) {
      DOM.fullForm.noteInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          this.blur();
        }
      });
    }

    document.addEventListener("click", (e) => {
      const input = e.target.closest("input, textarea");
      if (!input) return;
      if (["checkbox", "radio", "button", "submit", "file"].includes(input.type)) return;
      if (document.activeElement !== input) {
        e.preventDefault();
        input.focus({ preventScroll: true });
      }
    });

    const lastScreenId = sessionStorage.getItem("lastActiveScreen") || "home-screen";
    showScreen(lastScreenId);
    if (lastScreenId === "home-screen") renderSkeleton();

    (async function initializeData() {
      // Parallel Loading for visual instant start
      try {
        const [profileRes, catExpenseRes, catIncomeRes, transactionsRes, balanceRes] = await Promise.all([
          apiRequest(API_URLS.USER_PROFILE),
          apiRequest(`${API_URLS.CATEGORIES}?type=expense`),
          apiRequest(`${API_URLS.CATEGORIES}?type=income`),
          apiRequest(`${API_URLS.TRANSACTIONS}?limit=${state.limit}&offset=${state.offset}`),
          apiRequest(API_URLS.BALANCE),
        ]);

        // 1. Process User Profile First (to get Currency & Rates)
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          // Store Rates
          if (profileData.rates) {
              state.rates = profileData.rates;
          }
          if (profileData.base_currency) {
            state.baseCurrencyCode = profileData.base_currency;
            state.currencySymbol = CURRENCY_SYMBOLS[profileData.base_currency] || "$";
            DOM.settings.currencySelect.value = profileData.base_currency;
            tg.CloudStorage.setItem("currency_symbol", state.currencySymbol);
            // Update any labels that depend on currency immediately
            if (DOM.fullForm.currencyLabel) {
                DOM.fullForm.currencyLabel.textContent = state.currencySymbol;
            }
          }
        }

        // 2. Process Categories
        const expenseCats = catExpenseRes.ok ? await catExpenseRes.json() : [];
        const incomeCats = catIncomeRes.ok ? await catIncomeRes.json() : [];
        state.categories = [
          ...expenseCats.map((c) => ({ ...c, type: "expense" })),
          ...incomeCats.map((c) => ({ ...c, type: "income" })),
        ];
        renderQuickAddGrids();

        // 3. Process Transactions
        if (transactionsRes.ok) {
          const txData = await transactionsRes.json();
          state.transactions = txData;
          state.offset = txData.length;
          if (txData.length < state.limit) state.isAllLoaded = true;
          renderTransactions(state.transactions);
        }

        // 4. Process Balance
        if (balanceRes.ok) {
          const balanceData = await balanceRes.json();
          const serverBalance = parseFloat(balanceData.balance);
          // Simplified balance render for init
          const sign = serverBalance < 0 ? "-" : "";
          const absBalance = Math.abs(serverBalance);
          const hasCents = absBalance % 1 !== 0;
          const balanceFormatter = new Intl.NumberFormat("en-US", {
            minimumFractionDigits: hasCents ? 2 : 0,
            maximumFractionDigits: 2,
          });
          const newBalanceText = `${sign}${state.currencySymbol}${balanceFormatter.format(absBalance)}`;
          DOM.home.balanceAmount.textContent = newBalanceText;
        }

      } catch (e) {
        console.error("Critical Init Error", e);
        // Fallback or specific error handling if needed
        renderErrorState(DOM.home.listContainer, () => window.location.reload(), "Failed to initialize app.");
      }

      updateAiDescriptions(state.aiRange);

      setTimeout(() => {
        state.isInitialLoad = false;
        // Remove skeleton if it exists (renderTransactions clears listInnerHtml so it might be gone,
        // but if tx list was empty, we want to make sure skeleton is gone)
      }, 100);
    })();
  }

  init();
});
