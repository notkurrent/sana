document.addEventListener("DOMContentLoaded", () => {
  const tg = window.Telegram.WebApp;
  const tgInitData = tg.initData;

  // Инициализация Telegram
  tg.ready();
  tg.expand();
  try {
    tg.disableVerticalSwipes();
  } catch (e) {
    console.log("Vertical swipes disable not supported");
  }

  // --- CONFIG ---
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

  // Символы валют для отображения
  const CURRENCY_SYMBOLS = {
    USD: "$",
    TRY: "₺",
    KZT: "₸",
    RUB: "₽",
    EUR: "€",
    GBP: "£",
    UAH: "₴",
  };

  // --- STATE ---
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

    // Infinity Scroll
    offset: 0,
    limit: 100,
    isAllLoaded: false,
    isLoadingMore: false,
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

  async function apiRequest(url, options = {}) {
    if (!tgInitData) {
      console.error("CRITICAL: tgInitData is missing.");
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
    if (dateString && !dateString.endsWith("Z")) {
      return new Date(dateString + "Z");
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

  // --- LOGIC ---

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

      // 🔥 FIX: Если валюта изменилась (старый текст не содержит новый символ), не мигаем
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

  function showScreen(screenId) {
    DOM.screens.forEach((s) => s.classList.add("hidden"));
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) screenToShow.classList.remove("hidden");

    // 🔥 FIX: Сброс скролла в самый верх при смене экрана
    window.scrollTo(0, 0);

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

  // --- LOADERS ---
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
                <span class="base-amount" style="font-size: 0.75em; opacity: 0.6;">
                    ~${formatCurrency(tx.amount)}
                </span>
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

  // --- FORMS ---

  function handleEditTransactionClick(e) {
    const editBtn = e.target.closest(".edit-btn");
    if (!editBtn) return;
    tg.HapticFeedback.impactOccurred("light");
    const txId = parseInt(editBtn.dataset.txId, 10);
    const transactionToEdit = state.transactions.find((tx) => tx.id === txId);
    if (transactionToEdit) openEditScreen(transactionToEdit);
  }

  async function openEditScreen(tx) {
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

    // 🔥 FIX: Явно используем валюту транзакции, или валюту пользователя, или USD
    const currency = tx.currency || state.baseCurrencyCode || "USD";

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
    const txId = state.editTransaction.id;
    tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
      if (confirmed) {
        DOM.fullForm.saveBtn.disabled = true;
        DOM.fullForm.deleteBtn.disabled = true;
        const success = await deleteTransaction(txId);
        if (success) {
          tg.HapticFeedback.notificationOccurred("success");
          await loadTransactions();
          await fetchAndRenderBalance();
          showScreen("home-screen");
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

    // --- FIX TIME PRESERVATION START ---
    let dateToSend = dateInputVal;

    if (state.editTransaction) {
      const originalDateObj = parseDateFromUTC(state.editTransaction.date);
      const originalDateStr = getLocalDateString(originalDateObj);

      if (originalDateStr === dateInputVal) {
        dateToSend = state.editTransaction.date;
      }
    }
    // --- FIX END ---

    const txData = {
      category_id: parseInt(categoryId),
      amount: amount,
      currency: currency,
      date: dateToSend,
      note: note,
    };

    const txId = state.editTransaction ? state.editTransaction.id : null;
    const savedTransaction = await _saveTransaction(txData, txId);

    if (savedTransaction) {
      tg.HapticFeedback.notificationOccurred("success");
      const highlightId = txId ? null : savedTransaction.id;
      await loadTransactions(false, highlightId);
      await fetchAndRenderBalance();
      showScreen("home-screen");
    }
    DOM.fullForm.saveBtn.disabled = false;
    state.editTransaction = null;
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

    // Сброс состояния кнопки Add Note
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
    const savedTransaction = await _saveTransaction(txData);
    if (savedTransaction) {
      tg.HapticFeedback.notificationOccurred("success");
      closeBottomSheet();
      await loadTransactions(false, savedTransaction.id);
      await fetchAndRenderBalance();

      if (state.lastActiveScreen === "analytics-screen") {
        await loadAnalyticsPage();
      }

      showScreen("home-screen");
    }
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

  // --- SWIPES ---
  let swipeStartX = 0;
  let swipeStartY = 0;
  let currentSwipeElement = null;
  let isSwiping = false;
  const SWIPE_DELETE_BG_WIDTH = 90;
  const SWIPE_THRESHOLD = -80;

  function handleSwipeStart(e) {
    // Ищем ближайший элемент, который можно свайпать
    const target = e.target.closest(".expense-item") || e.target.closest(".category-item-wrapper");

    // Если кликнули на кнопку редактирования — свайп не начинаем
    if (e.target.closest(".edit-btn")) return;

    // Запрет свайпа для дефолтных категорий
    if (target && target.classList.contains("category-item-wrapper") && target.dataset.isDefault === "true") return;

    if (!target) return;

    currentSwipeElement = target;
    isSwiping = false; // Сбрасываем флаг начала свайпа
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;

    // Убираем плавность анимации в начале, чтобы элемент следовал за пальцем мгновенно
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

    // 1. ОПРЕДЕЛЕНИЕ НАМЕРЕНИЯ (Свайп или Скролл?)
    if (!isSwiping) {
      // Если движение по вертикали больше, чем по горизонтали — это скролл.
      // Сбрасываем элемент и даем браузеру скроллить.
      if (Math.abs(diffY) > Math.abs(diffX)) {
        currentSwipeElement = null;
        return;
      }

      // Если движение по горизонтали явное (> 5px) — начинаем свайп
      if (Math.abs(diffX) > 5) {
        isSwiping = true;
      }
    }

    // 2. ЛОГИКА СВАЙПА
    if (isSwiping) {
      // Блокируем скролл страницы, пока свайпаем
      if (e.cancelable) e.preventDefault();

      const content =
        currentSwipeElement.querySelector(".expense-item-content") ||
        currentSwipeElement.querySelector(".category-item-content");

      if (!content) return;

      // Разрешаем двигать только влево (diffX < 0)
      let moveX = diffX > 0 ? 0 : diffX;

      // Эффект "резинки" (сопротивление), если тянем дальше ширины кнопки
      if (moveX < -SWIPE_DELETE_BG_WIDTH) {
        // Формула затухания: moveX = limit - (излишек ^ 0.7)
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

    // Возвращаем плавную анимацию для завершения жеста
    if (content) content.style.transition = "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)";

    // Получаем текущее смещение (через матрицу трансформации или просто расчет)
    // Упрощенно: если мы в режиме свайпа и сдвинули достаточно далеко влево
    const currentX = e.changedTouches[0].clientX;
    const diffX = currentX - swipeStartX;

    if (isSwiping && diffX < SWIPE_THRESHOLD) {
      // --- УСПЕШНЫЙ СВАЙП (УДАЛЕНИЕ) ---

      // 1. Фиксируем открытое состояние
      content.style.transform = `translateX(-${SWIPE_DELETE_BG_WIDTH}px)`;

      // 2. Вибрация
      tg.HapticFeedback.impactOccurred("medium");

      // 3. Логика удаления
      if (currentSwipeElement.classList.contains("category-item-wrapper")) {
        handleDeleteCategory(currentSwipeElement.dataset.id, content);
      } else {
        handleDeleteSwipe(currentSwipeElement, content);
      }
    } else {
      // --- ОТМЕНА СВАЙПА (ВОЗВРАТ) ---
      content.style.transform = "translateX(0)";
    }

    // Сброс состояния
    currentSwipeElement = null;
    isSwiping = false;
  }

  function handleDeleteSwipe(element, content) {
    const editBtn = element.querySelector(".edit-btn");
    const txId = parseInt(editBtn.dataset.txId, 10);

    tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
      if (confirmed) {
        tg.HapticFeedback.notificationOccurred("success");
        element.style.height = element.offsetHeight + "px";
        requestAnimationFrame(() => {
          element.classList.add("deleting");
          element.style.height = "0px";
          element.style.margin = "0px";
          element.style.padding = "0px";
        });
        element.addEventListener(
          "transitionend",
          async () => {
            await deleteTransaction(txId);
            await loadTransactions();
            await fetchAndRenderBalance();
          },
          { once: true }
        );
      } else {
        content.style.transform = "translateX(0)";
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

  // Drill-down рендер категорий
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
      // Обертка для свайпа
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

      // Клик открывает редактирование, если не свайпаем и не дефолтная
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

  // Логика экрана редактирования категории
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
      await loadAllCategories(); // Перезагружаем категории
      await loadTransactions(); // Обновляем транзакции
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

  // Поддержка свайп-контента
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
      if (swipeElement) swipeElement.style.transform = "translateX(0)";
      return;
    }
    if (transactionCount > 0) {
      const txWord = transactionCount === 1 ? "transaction" : "transactions";
      message = `This category is linked to ${transactionCount} ${txWord}.\n\nIt will be hidden from the list, but your past history will remain safe.\n\n(Tip: You can restore it anytime by creating a category with the exact same name).`;
    }

    tg.showConfirm(message, async (confirmed) => {
      if (confirmed) {
        try {
          // Анимация удаления (только для свайпа)
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

          await loadAllCategories();
          loadCategoriesScreen(); // Перерисовываем список
          await loadTransactions();
          await fetchAndRenderBalance();

          // 🔥 FIX: Если удалили через Кнопку (не свайпом) — точно уходим назад в список
          if (!swipeElement) {
            showScreen("categories-screen");
          }
        } catch (e) {
          console.error(e);
        }
      } else {
        // Отмена свайпа
        if (swipeElement) {
          swipeElement.style.transform = "translateX(0)";
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

  // --- INIT ---
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
      showScreen(state.lastActiveScreen);
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

    // Свайпы для списков
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

    // Кнопки навигации календаря
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

    // 🔥 FIX: Обновление календаря при выборе в выпадающем списке (Select)
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
    // --- Конец фикса ---

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

      // 🔥 FIX: Длинные описания для ВСЕХ режимов, чтобы высота была одинаковой
      if (range === "all") {
        DOM.ai.btnAdvice.querySelector("p").textContent = "An actionable tip based on your entire spending history.";
        DOM.ai.btnSummary.querySelector("p").textContent =
          "A detailed breakdown of your total income and expenses for all-time.";
        DOM.ai.btnAnomaly.querySelector("p").textContent =
          "Find the largest single expense recorded in your entire history.";
      } else {
        // Делаем первую букву заглавной (day -> Day)
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

    // Обработчик клика по кнопке Add Note
    if (DOM.quickModal.noteToggleBtn) {
      DOM.quickModal.noteToggleBtn.addEventListener("click", () => {
        tg.HapticFeedback.impactOccurred("light");
        DOM.quickModal.noteToggleBtn.classList.add("hidden");
        DOM.quickModal.noteInput.classList.remove("hidden");
        DOM.quickModal.noteInput.classList.add("fade-in");

        // 🔥 FIX: Фокус сразу (для клавиатуры), но без скролла (от прыжков)
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

    // Обработчики для экрана редактирования
    DOM.editCategory.saveBtn.addEventListener("click", saveEditedCategory);
    DOM.editCategory.deleteBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("heavy");
      if (state.categoryBeingEdited) handleDeleteCategory(state.categoryBeingEdited.id);
    });
    DOM.editCategory.backBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("light");
      showScreen("categories-screen");
    });

    // 🔥 UX: Скрываем таб-бар и футер ТОЛЬКО при вводе текста (Fix for Select/Date)
    document.addEventListener("focusin", (e) => {
      const tag = e.target.tagName;
      // Получаем тип инпута (text, number, date и т.д.)
      const type = e.target.getAttribute("type");

      // Типы полей, которые реально вызывают клавиатуру
      const keyboardTypes = ["text", "number", "tel", "email", "password", "search", "url"];

      // 1. Если это TEXTAREA — всегда скрываем
      if (tag === "TEXTAREA") {
        document.body.classList.add("keyboard-open");
        return;
      }

      // 2. Если это INPUT, проверяем, текстовый ли он
      if (tag === "INPUT" && keyboardTypes.includes(type)) {
        document.body.classList.add("keyboard-open");
      }
      // SELECT и input[type="date"] игнорируются -> таб-бар остается
    });

    document.addEventListener("focusout", (e) => {
      setTimeout(() => {
        const active = document.activeElement;

        // Проверяем, куда ушел фокус. Если снова в текстовое поле — не возвращаем таб-бар.
        const tag = active ? active.tagName : null;
        const type = active ? active.getAttribute("type") : null;
        const keyboardTypes = ["text", "number", "tel", "email", "password", "search", "url"];

        const isKeyboardInput = tag === "TEXTAREA" || (tag === "INPUT" && keyboardTypes.includes(type));

        if (!isKeyboardInput) {
          document.body.classList.remove("keyboard-open");
        }
      }, 50);
    });

    // 🔥 БЛОКИРОВКА ENTER В ЗАМЕТКЕ (Full Form)
    if (DOM.fullForm.noteInput) {
      DOM.fullForm.noteInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault(); // Запрещаем перенос строки
          this.blur(); // Скрываем клавиатуру
        }
      });
    }

    // 🔥 ГЛОБАЛЬНЫЙ ФИКС: Плавный фокус для всех инпутов (без прыжков)
    document.addEventListener("click", (e) => {
      const input = e.target.closest("input, textarea");
      if (!input) return;

      // Игнорируем чекбоксы, радио и кнопки
      if (["checkbox", "radio", "button", "submit", "file"].includes(input.type)) return;

      // Если инпут еще не в фокусе - перехватываем
      if (document.activeElement !== input) {
        e.preventDefault(); // Отменяем стандартный скачок браузера
        input.focus({ preventScroll: true }); // Фокусируемся плавно
      }
    });

    const lastScreenId = sessionStorage.getItem("lastActiveScreen") || "home-screen";
    showScreen(lastScreenId);
    if (lastScreenId === "home-screen") renderSkeleton();

    (async function initializeData() {
      await Promise.all([fetchUserProfile(), loadAllCategories()]);
      await Promise.all([loadTransactions(false), fetchAndRenderBalance()]);
      setTimeout(() => {
        state.isInitialLoad = false;
      }, 100);
    })();
  }

  init();
});
