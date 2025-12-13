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
    CATEGORIES: "/api/categories",
    AI_ADVICE: "/api/ai/advice",
    ANALYTICS_SUMMARY: "/api/analytics/summary",
    ANALYTICS_CALENDAR: "/api/analytics/calendar",
    USER_RESET: "/api/users/me/reset",
  };

  // --- STATE ---
  const state = {
    transactions: [],
    categories: [],
    currencySymbol: "$",
    editTransaction: null,
    quickCategory: null,
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
  };

  // --- HELPERS & FORMATTERS ---

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

    const config = {
      ...options,
      headers: headers,
    };

    try {
      const response = await fetch(url, config);

      // Обработка 401/403 как в старом коде
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

  function formatCurrency(amount) {
    if (typeof amount !== "number") amount = 0;
    return `${state.currencySymbol}${amount.toFixed(2)}`;
  }

  function formatCurrencyForSummary(amount) {
    if (typeof amount !== "number") amount = 0;
    const sign = amount < 0 ? "-" : amount > 0 ? "+" : "";
    const absAmount = Math.abs(amount);
    let formattedAmount;
    if (absAmount >= 1000000) formattedAmount = (absAmount / 1000000).toFixed(2) + "M";
    else if (absAmount >= 10000) formattedAmount = (absAmount / 1000).toFixed(0) + "K";
    else if (absAmount >= 1000) formattedAmount = (absAmount / 1000).toFixed(1) + "K";
    else formattedAmount = absAmount.toFixed(2);

    return amount === 0 ? `${state.currencySymbol}0.00` : `${sign}${state.currencySymbol}${formattedAmount}`;
  }

  function formatForDayMarker(amount) {
    if (!amount) return "";
    const absAmount = Math.abs(Math.round(amount));
    const sign = amount < 0 ? "-" : "+";
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
    fullForm: {
      screen: document.getElementById("full-form-screen"),
      title: document.getElementById("form-title"),
      typeWrapper: document.getElementById("form-type-wrapper"),
      typeExpense: document.getElementById("form-type-expense"),
      typeIncome: document.getElementById("form-type-income"),
      categorySelect: document.getElementById("category-select"),
      amountInput: document.getElementById("transaction-amount"),
      dateInput: document.getElementById("transaction-date"),
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
      currency: document.getElementById("quick-modal-currency"),
      amountInput: document.getElementById("quick-modal-amount"),
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

  function updateBalance() {
    const container = DOM.home.balanceAmount.closest(".total-container");
    const oldBalanceText = DOM.home.balanceAmount.textContent;
    const newBalance = state.transactions.reduce((acc, tx) => {
      return tx.type === "income" ? acc + tx.amount : acc - tx.amount;
    }, 0);
    const sign = newBalance < 0 ? "-" : "";
    const absBalance = Math.abs(newBalance);
    const hasCents = absBalance % 1 !== 0;
    const balanceFormatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    });
    const newBalanceText = `${sign}${state.currencySymbol}${balanceFormatter.format(absBalance)}`;

    DOM.home.balanceAmount.textContent = newBalanceText;

    if (newBalanceText === oldBalanceText || !container || state.isInitialLoad) return;

    const oldBalance = parseFloat(oldBalanceText.replace(/[^0-9.-]+/g, "")) || 0;
    const classToAdd = newBalance > oldBalance ? "balance-flash-positive" : "balance-flash-negative";
    container.classList.remove("balance-flash-positive", "balance-flash-negative");
    requestAnimationFrame(() => container.classList.add(classToAdd));
    container.addEventListener("animationend", () => container.classList.remove(classToAdd), { once: true });
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

    DOM.tabs.home.classList.toggle("active", screenId === "home-screen");
    DOM.tabs.analytics.classList.toggle("active", screenId === "analytics-screen");
    DOM.tabs.ai.classList.toggle("active", screenId === "ai-screen");
    DOM.tabs.settings.classList.toggle("active", screenId === "settings-screen");
    DOM.tabs.add.classList.toggle(
      "active",
      ["quick-add-screen", "full-form-screen", "categories-screen"].includes(screenId)
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
    const editIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>`;
    const trashIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path fill-rule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z" clip-rule="evenodd" /></svg>`;

    const txDate = parseDateFromUTC(tx.date);
    const formattedTime = formatTime(txDate);
    const { icon: customEmoji, name: categoryName } = parseCategory(tx.category);

    // Эмодзи с фоллбэком
    let categoryDisplay;
    if (customEmoji) {
      categoryDisplay = `${customEmoji} ${categoryName}`;
    } else if (defaultEmojis[categoryName]) {
      categoryDisplay = `${defaultEmojis[categoryName]} ${categoryName}`;
    } else {
      const defaultIcon = tx.type === "income" ? defaultIconIncome : defaultIconExpense;
      categoryDisplay = `${defaultIcon} ${categoryName}`;
    }

    item.innerHTML = `
        <div class="expense-item-delete-bg">${trashIconSvg}</div>
        <div class="expense-item-content">
          <div class="tx-info">
            <span class="tx-category">${categoryDisplay}</span>
            <span class="tx-time">${formattedTime}</span>
          </div>
          <div class="expense-item-details">
            <span class="tx-amount ${tx.type}">${tx.type === "income" ? "+" : "-"}${formatCurrency(tx.amount)}</span>
            <button class="edit-btn" data-tx-id="${tx.id}">${editIconSvg}</button>
          </div>
        </div>`;
    return item;
  }

  function renderTransactions(transactions = [], highlightId = null) {
    DOM.home.listContainer.innerHTML = "";
    if (transactions.length === 0) {
      DOM.home.listContainer.innerHTML = `
          <div class="list-placeholder">
            <span class="icon">📁</span>
            <h3>All Clear!</h3>
            <p>
              Your new transactions will appear here.
              Tap the <strong>(+)</strong> button below to add your first one.
            </p>
          </div>`;
      updateBalance();
      return;
    }

    let currentHeaderDate = "";
    transactions.forEach((tx) => {
      const txDate = parseDateFromUTC(tx.date);
      const dateHeader = formatDateForTitle(txDate);
      if (dateHeader !== currentHeaderDate) {
        const headerEl = document.createElement("div");
        headerEl.className = "date-header";
        headerEl.textContent = dateHeader;
        DOM.home.listContainer.appendChild(headerEl);
        currentHeaderDate = dateHeader;
      }
      const item = createTransactionElement(tx);
      if (tx.id === highlightId) {
        item.classList.add("new-item-animation");
        item.addEventListener("animationend", () => item.classList.remove("new-item-animation"), { once: true });
      }
      DOM.home.listContainer.appendChild(item);
    });
    updateBalance();
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

  async function loadTransactions(highlightId = null) {
    try {
      const response = await apiRequest(API_URLS.TRANSACTIONS);
      if (!response.ok) throw new Error("Network response was not ok");
      state.transactions = await response.json();
      renderTransactions(state.transactions, highlightId);
      state.isInitialLoad = false;
    } catch (error) {
      renderErrorState(
        DOM.home.listContainer,
        () => {
          renderSkeleton();
          loadTransactions();
        },
        "Failed to load your transactions."
      );
    }
  }

  function renderQuickAddGrids() {
    DOM.quickAdd.gridExpense.innerHTML = "";
    DOM.quickAdd.gridIncome.innerHTML = "";
    state.categories.forEach((cat) => {
      const { icon: customEmoji, name: categoryName } = parseCategory(cat.name);
      // Эмодзи для кнопок
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

    DOM.fullForm.amountInput.value = tx.amount;
    const dateObj = parseDateFromUTC(tx.date);
    DOM.fullForm.dateInput.value = dateObj.toISOString().split("T")[0];
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
    DOM.fullForm.dateInput.valueAsDate = new Date();

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
    // 🔥 ФИКС: Возвращаем "душевный" текст
    tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
      if (confirmed) {
        DOM.fullForm.saveBtn.disabled = true;
        DOM.fullForm.deleteBtn.disabled = true;
        const success = await deleteTransaction(txId);
        if (success) {
          tg.HapticFeedback.notificationOccurred("success");
          await loadTransactions();
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
      body = { category_id: txData.category_id, amount: txData.amount, date: txData.date };
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
    const date = DOM.fullForm.dateInput.value;

    if (!categoryId || isNaN(amount) || amount <= 0 || !date) {
      // 🔥 ФИКС: Возвращаем "friendly" текст
      tg.showAlert("Please fill all fields with valid data.");
      return;
    }
    DOM.fullForm.saveBtn.disabled = true;

    const txData = { category_id: parseInt(categoryId), amount: amount, date: date };
    const txId = state.editTransaction ? state.editTransaction.id : null;
    const savedTransaction = await _saveTransaction(txData, txId);

    if (savedTransaction) {
      tg.HapticFeedback.notificationOccurred("success");
      await loadTransactions(txId ? null : savedTransaction.id);
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
    DOM.quickModal.currency.textContent = state.currencySymbol;
    DOM.quickModal.amountInput.value = "";
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
    };
    const savedTransaction = await _saveTransaction(txData);
    if (savedTransaction) {
      tg.HapticFeedback.notificationOccurred("success");
      closeBottomSheet();
      await loadTransactions(savedTransaction.id);
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
    const txItem = e.target.closest(".expense-item");
    if (!txItem || e.target.closest(".edit-btn") || isSwiping) return;
    currentSwipeElement = txItem;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
  }

  function handleSwipeMove(e) {
    if (!currentSwipeElement) return;
    const diffX = e.touches[0].clientX - swipeStartX;
    const diffY = e.touches[0].clientY - swipeStartY;
    if (!isSwiping) {
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) isSwiping = true;
      else if (Math.abs(diffY) > Math.abs(diffX)) {
        currentSwipeElement = null;
        return;
      }
    }
    if (isSwiping) {
      e.preventDefault();
      const content = currentSwipeElement.querySelector(".expense-item-content");
      let moveX = diffX > 0 ? 0 : diffX;
      if (moveX < -SWIPE_DELETE_BG_WIDTH)
        moveX = -SWIPE_DELETE_BG_WIDTH - Math.pow(-moveX - SWIPE_DELETE_BG_WIDTH, 0.7);
      content.classList.add("swiping");
      content.style.transform = `translateX(${moveX}px)`;
    }
  }

  function handleSwipeEnd() {
    if (!currentSwipeElement) return;
    const content = currentSwipeElement.querySelector(".expense-item-content");
    content.classList.remove("swiping");
    const currentTransform = new DOMMatrix(getComputedStyle(content).transform).m41;
    if (isSwiping && currentTransform <= SWIPE_THRESHOLD) {
      content.style.transform = `translateX(-${SWIPE_DELETE_BG_WIDTH}px)`;
      handleDeleteSwipe(currentSwipeElement, content);
    } else {
      content.style.transform = "translateX(0)";
    }
    currentSwipeElement = null;
    isSwiping = false;
  }

  function handleDeleteSwipe(element, content) {
    const editBtn = element.querySelector(".edit-btn");
    const txId = parseInt(editBtn.dataset.txId, 10);
    tg.HapticFeedback.impactOccurred("medium");
    // 🔥 ФИКС: Возвращаем "душевный" текст
    tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
      if (confirmed) {
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

        // Логика эмодзи
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
      showScreen("home-screen");
      // 🔥 ФИКС: Возвращаем "душевный" текст
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
      item.className = "category-item";

      const { icon, name } = parseCategory(cat.name);
      let displayName = name;

      if (!icon && defaultEmojis[name]) {
        displayName = `${defaultEmojis[name]} ${name}`;
      } else if (icon) {
        displayName = `${icon} ${name}`;
      } else {
        const defIcon = state.categoryType === "income" ? defaultIconIncome : defaultIconExpense;
        displayName = `${defIcon} ${name}`;
      }

      let badgeHtml = "";
      let deleteButtonHtml = "";

      if (cat.user_id === null) {
        badgeHtml = `<span class="default-badge">Default</span>`;
      } else {
        deleteButtonHtml = `
              <button class="delete-category-btn" data-id="${cat.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
              </button>
          `;
      }

      item.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span>${displayName}</span>
                ${badgeHtml}
            </div>
            ${deleteButtonHtml}
        `;
      DOM.categories.list.appendChild(item);
    });
  }

  async function handleAddCategory() {
    const icon = DOM.categories.newIconInput.value.trim();
    const name = DOM.categories.newNameInput.value.trim();

    // 🔥 ФИКС: Текст
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

  async function handleDeleteCategory(categoryId) {
    // 🔥 ФИКС: ВОССТАНОВЛЕНА ПОЛНАЯ ЛОГИКА WARNING
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
      return;
    }

    if (transactionCount > 0) {
      const txWord = transactionCount === 1 ? "transaction" : "transactions";
      message = `Warning: This category is linked to ${transactionCount} ${txWord}. Deleting it will also delete all associated transactions.\n\nAre you sure you want to proceed?`;
    }

    tg.showConfirm(message, async (confirmed) => {
      if (confirmed) {
        try {
          const deleteResponse = await apiRequest(`${API_URLS.CATEGORIES}/${categoryId}`, { method: "DELETE" });
          if (!deleteResponse.ok) throw new Error("Delete failed");

          tg.HapticFeedback.notificationOccurred("success");
          await loadAllCategories();
          loadCategoriesScreen();
          await loadTransactions();
        } catch (e) {
          console.error(e);
        }
      }
    });
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

    // Navigation Listeners
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

    // UI Listeners
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

    // Swipe & Drag Setup
    setupSheetDrag(DOM.daySheet.sheet, DOM.daySheet.header, DOM.daySheet.contentWrapper, closeBottomSheet);
    setupSheetDrag(DOM.quickModal.sheet, DOM.quickModal.header, null, closeBottomSheet);
    setupSheetDrag(DOM.summarySheet.sheet, DOM.summarySheet.header, null, closeBottomSheet);
    [DOM.home.listContainer, DOM.daySheet.list].forEach((list) => {
      list.addEventListener("touchstart", handleSwipeStart, { passive: true });
      list.addEventListener("touchmove", handleSwipeMove, { passive: false });
      list.addEventListener("touchend", handleSwipeEnd);
    });

    // Analytics Listeners
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
    DOM.calendar.boxIncome.addEventListener("click", () => openSummarySheet("income", state.calendarSummary.income));
    DOM.calendar.boxExpense.addEventListener("click", () =>
      openSummarySheet("expense", state.calendarSummary.expense * -1)
    );
    DOM.calendar.boxNet.addEventListener("click", () => openSummarySheet("net", state.calendarSummary.net));

    // AI & Settings Listeners
    DOM.ai.dateFilter.addEventListener("click", (e) => {
      const target = e.target.closest(".seg-button");
      if (!target) return;
      tg.HapticFeedback.impactOccurred("light");
      DOM.ai.dateFilter.querySelectorAll(".seg-button").forEach((btn) => btn.classList.remove("active"));
      target.classList.add("active");

      const range = target.dataset.range;
      state.aiRange = range;
      const periodText = range === "all" ? "all-time" : `this ${range}'s`;

      DOM.ai.btnAdvice.querySelector("p").textContent = `An actionable tip based on ${periodText} spending.`;
      DOM.ai.btnSummary.querySelector("p").textContent = `A quick summary of totals for ${periodText}.`;
      DOM.ai.btnAnomaly.querySelector("p").textContent = `Find the largest single expense for ${periodText}.`;
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
    DOM.settings.currencySelect.addEventListener("change", (e) => {
      tg.HapticFeedback.impactOccurred("light");
      tg.CloudStorage.setItem("currency_symbol", e.target.value, (e, s) => {
        if (s) {
          state.currencySymbol = e.target.value;
          loadTransactions();
          tg.showPopup({
            title: "Currency Updated",
            message: `Your default currency is now ${state.currencySymbol}.`,
            buttons: [{ type: "ok" }],
          });
        }
      });
    });
    DOM.settings.resetDataBtn.addEventListener("click", () => {
      tg.HapticFeedback.impactOccurred("heavy");

      // 1. Первая проверка
      tg.showConfirm("Are you sure? All your transactions and custom categories will be deleted.", (firstConfirm) => {
        if (firstConfirm) {
          // 2. Вторая проверка (запускается только если нажали ОК в первой)
          tg.showConfirm("Are you 100% sure? This action CANNOT be undone!", (secondConfirm) => {
            if (secondConfirm) {
              // 3. Выполняем сброс только после ДВУХ подтверждений
              handleResetData();
            }
          });
        }
      });
    });

    // Delegated Clicks
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
    DOM.categories.list.addEventListener("click", (e) => {
      const btn = e.target.closest(".delete-category-btn");
      if (btn) handleDeleteCategory(btn.dataset.id);
    });

    // Start
    const lastScreenId = sessionStorage.getItem("lastActiveScreen") || "home-screen";
    showScreen(lastScreenId);
    if (lastScreenId === "home-screen") renderSkeleton();

    tg.CloudStorage.getItem("currency_symbol", async (err, value) => {
      state.currencySymbol = value || "$";
      DOM.settings.currencySelect.value = state.currencySymbol;
      await Promise.all([loadAllCategories(), loadTransactions()]);
    });
  }

  init();
});
