document.addEventListener("DOMContentLoaded", () => {
    
    const tg = window.Telegram.WebApp;
    // ⬇️ --- ШАГ 1: ПОЛУЧАЕМ initData ---
    // Мы больше не доверяем unsafe-версии.
    // Мы будем отправлять 'tgInitData' в заголовках КАЖДОГО запроса.
    const tgInitData = tg.initData;
    const userId = tg.initDataUnsafe?.user?.id; // Оставляем для UI, но не для API
    // ⬆️ --- КОНЕЦ ШАГА 1 ---
    
    tg.ready();
    tg.expand();
    
    // Отключаем "pull-to-refresh"
    tg.disableVerticalSwipes(); 
    
    const API_URLS = {
        TRANSACTIONS: "/transactions",
        CATEGORIES: "/categories",
        AI_ADVICE: "/ai-advice",
        ANALYTICS_SUMMARY: "/analytics/summary",
        ANALYTICS_CALENDAR: "/analytics/calendar",
        USER_RESET: "/users/me/reset",
    };

    let currentEditTransaction = null;
    let currentChart = null; 
    let currentAnalyticsDate = new Date(); 
    let currentSummaryRange = 'month';
    let currentCurrencySymbol = "$";
    let currentCategoryManagementType = 'expense';
    let currentAiRange = 'month';
    let allTransactions = []; 
    let allCategories = []; 
    let currentQuickCategory = null;
    let lastActiveScreen = 'home-screen'; 
    let activeBottomSheet = null; 
    let isInitialLoad = true; 

    let swipeStartX = 0;
    let swipeStartY = 0;
    let currentSwipeElement = null;
    let isSwiping = false;
    const SWIPE_DELETE_BG_WIDTH = 90; 
    const SWIPE_THRESHOLD = -80;      

    const defaultEmojis = {
        'Food': '🍔', 'Transport': '🚌', 'Housing': '🏠',
        'Entertainment': '🎬', 'Salary': '💰', 'Freelance': '💻',
        'Gifts': '🎁', 
    };
    const defaultIconExpense = '📦';
    const defaultIconIncome = '💎';

    // ❗️❗️❗️ ВОТ БЛОК, КОТОРЫЙ ПРОПАЛ В ПРОШЛЫЙ РАЗ (Я ЕГО ВОССТАНОВИЛ)
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true
    });
    const headerDateFormatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    const formatDateForTitle = (date) => headerDateFormatter.format(date);
    const formatTime = (date) => timeFormatter.format(date);
    // ❗️❗️❗️ КОНЕЦ ВОССТАНОВЛЕННОГО БЛОКА

    // ---
    // --- Кешированные DOM-элементы (без изменений)
    // ---
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
        
        tabs: {
            home: document.getElementById("tab-home"),
            analytics: document.getElementById("tab-analytics"),
            add: document.getElementById("tab-add"),
            ai: document.getElementById("tab-ai"),
            settings: document.getElementById("tab-settings"),
        }
    };
    
    // ---
    // --- ⬇️ --- ШАГ 2: ЦЕНТРАЛИЗОВАННЫЕ ЗАГОЛОВКИ АУТЕНТИФИКАЦИИ ---
    // ---
    
    /**
     * Возвращает объект заголовков, необходимый для аутентификации на бэкенде.
     * @param {boolean} isJson - Установить ли 'Content-Type': 'application/json'?
     * @returns {HeadersInit}
     */
    function getAuthHeaders(isJson = true) {
        if (!tgInitData) {
            console.error("CRITICAL: tgInitData is missing.");
            tg.showAlert("Authentication data is missing. Please restart the app.");
        }
        
        const headers = {
            'X-Telegram-InitData': tgInitData
        };
        
        if (isJson) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }

    // ---
    // --- ⬆️ --- КОНЕЦ ШАГА 2 ---
    // ---

    // ---
    // --- Вспомогательные функции
    // ---

    function getLocalDateString(date) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    function parseCategory(fullName) {
        if (!fullName) return { icon: null, name: "" };
        const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji})(\p{Emoji_Modifier}|\uFE0F)*/u;
        const match = fullName.match(emojiRegex);
        if (match && match[0]) {
            const icon = match[0];
            const name = fullName.substring(icon.length).trim(); 
            return { icon, name };
        } else {
            return { icon: null, name: fullName.trim() };
        }
    }
    
    // --- ⬇️ НОВАЯ ФУНКЦИЯ (с аббревиатурой) ⬇️ ---
function formatCurrency(amount) {
    if (typeof amount !== 'number') {
        amount = 0;
    }

    // Сохраняем знак (плюс/минус)
    const sign = amount < 0 ? "-" : (amount > 0 ? "+" : "");
    const absAmount = Math.abs(amount);

    let formattedAmount;

    // Решаем, как форматировать, в зависимости от величины
    if (absAmount >= 1000000) {
        // Миллионы
        formattedAmount = (absAmount / 1000000).toFixed(1) + 'M';
    } else if (absAmount >= 10000) {
        // Десятки тысяч (без .0, просто 10K, 25K)
        formattedAmount = (absAmount / 1000).toFixed(0) + 'K';
    } else if (absAmount >= 1000) {
        // Тысячи (с .0, например 1.3K, 9.9K)
        formattedAmount = (absAmount / 1000).toFixed(1) + 'K';
    } else if (absAmount < 1) {
        // Меньше 1 (0.50)
        formattedAmount = absAmount.toFixed(2);
    } else {
        // Обычные числа (1.00, 13.00, 220.00, 999.00)
        formattedAmount = absAmount.toFixed(0); 
    }

    // Собираем обратно
    // (Не добавляем знак $, если это 0)
    if (amount === 0) {
        return `${currentCurrencySymbol}0`; // Просто $0
    }
    
    // Для Income/Expense в календаре:
    // +$3.6K
    // -$1.3K
    // +$556
    return `${sign}${currentCurrencySymbol}${formattedAmount}`;
}
    
    function updateBalance() {
        const container = DOM.home.balanceAmount.closest('.total-container');
        const oldBalanceText = DOM.home.balanceAmount.textContent.replace(/[$,]/g, '');
        const oldBalance = parseFloat(oldBalanceText) || 0;
        const newBalance = allTransactions.reduce((acc, tx) => {
            return tx.type === 'income' ? acc + tx.amount : acc - tx.amount;
        }, 0);
        DOM.home.balanceAmount.textContent = formatCurrency(newBalance);
        if (newBalance === oldBalance || !container || isInitialLoad) { return; }
        const classToAdd = newBalance > oldBalance ? 'balance-flash-positive' : 'balance-flash-negative';
        container.classList.remove('balance-flash-positive', 'balance-flash-negative');
        requestAnimationFrame(() => { container.classList.add(classToAdd); });
        container.addEventListener('animationend', () => {
            container.classList.remove(classToAdd);
        }, { once: true });
    }
    
    async function handleFetchError(response, defaultErrorMsg = "An error occurred") {
        let errorMsg = defaultErrorMsg;
        try {
            const errorData = await response.json();
            errorMsg = errorData.detail || errorData.message || defaultErrorMsg;
        } catch (e) { /* Ошибка парсинга JSON */ }
        
        // 🚫 Важная проверка безопасности
        if (response.status === 403) {
             errorMsg = "Authentication Failed. Please try restarting the app inside Telegram.";
        }
        
        console.error("Fetch Error:", errorMsg);
        tg.showAlert(errorMsg);
        return errorMsg; 
    }

    function renderErrorState(container, retryCallback, message = "Failed to load data.") {
        container.innerHTML = `
            <div class="list-placeholder">
                <span class="icon">☁️</span>
                <h3>Couldn't Connect</h3>
                <p>${message} Please check your connection and try again.</p>
                <button class="placeholder-btn">Retry</button>
            </div>
        `;
        const retryBtn = container.querySelector('.placeholder-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                tg.HapticFeedback.impactOccurred('light');
                retryCallback();
            });
        }
    }
    
    function showScreen(screenId) {
        DOM.screens.forEach(s => s.classList.add("hidden"));
        const screenToShow = document.getElementById(screenId);
        if (screenToShow) screenToShow.classList.remove("hidden");
        DOM.tabs.home.classList.toggle('active', screenId === 'home-screen');
        DOM.tabs.analytics.classList.toggle('active', screenId === 'analytics-screen');
        DOM.tabs.ai.classList.toggle('active', screenId === 'ai-screen');
        DOM.tabs.settings.classList.toggle('active', screenId === 'settings-screen');
        DOM.tabs.add.classList.toggle('active', ['quick-add-screen', 'full-form-screen', 'categories-screen'].includes(screenId));
        if (['home-screen', 'analytics-screen', 'ai-screen', 'settings-screen', 'quick-add-screen'].includes(screenId)) {
            sessionStorage.setItem('lastActiveScreen', screenId);
            lastActiveScreen = screenId;
        }
        if (screenId === 'analytics-screen') {
            const lastAnalyticsTab = sessionStorage.getItem('lastAnalyticsTab') || 'summary';
            if (lastAnalyticsTab === 'calendar') {
                DOM.analytics.summaryPane.classList.add('hidden');
                DOM.analytics.calendarPane.classList.remove('hidden');
                DOM.analytics.segBtnSummary.classList.remove('active');
                DOM.analytics.segBtnCalendar.classList.add('active');
            } else {
                DOM.analytics.summaryPane.classList.remove('hidden');
                DOM.analytics.calendarPane.classList.add('hidden');
                DOM.analytics.segBtnSummary.classList.add('active');
                DOM.analytics.segBtnCalendar.classList.remove('active');
            }
            loadAnalyticsPage(); 
        } else if (screenId === 'categories-screen') {
            loadCategoriesScreen();
        } else if (screenId === 'ai-screen') {
            DOM.ai.featuresList.classList.remove('hidden');
            DOM.ai.resultContainer.classList.add('hidden');
        } else if (screenId === 'quick-add-screen') {
            renderQuickAddGrids();
        }
    }
    
    // ---
    // --- ⬇️ --- ШАГ 3: ОБНОВЛЕНИЕ ВСЕХ FETCH-ЗАПРОСОВ ---
    // ---

    async function loadAllCategories() {
        if (!tgInitData) return; // 👈 Проверяем tgInitData
        try {
            const [expenseRes, incomeRes] = await Promise.all([
                // 🚫 УБРАЛИ: &user_id=${userId}
                // ✅ ДОБАВИЛИ: { headers: ... }
                fetch(`${API_URLS.CATEGORIES}?type=expense`, {
                    headers: getAuthHeaders(false) // false, так как нет JSON body
                }),
                fetch(`${API_URLS.CATEGORIES}?type=income`, {
                    headers: getAuthHeaders(false) 
                })
            ]);
            
            if (!expenseRes.ok || !incomeRes.ok) {
                throw new Error("Network response was not ok for categories");
            }
            
            const expenseCats = await expenseRes.json();
            const incomeCats = await incomeRes.json();
            
            allCategories = [
                ...expenseCats.map(c => ({...c, type: 'expense'})),
                ...incomeCats.map(c => ({...c, type: 'income'}))
            ];
            
            renderQuickAddGrids();
            
        } catch (error) {
            console.error("Failed to load categories:", error);
            renderErrorState(DOM.quickAdd.gridExpense, () => {
                DOM.quickAdd.gridExpense.innerHTML = `<p class="list-placeholder" style="grid-column: 1 / -1;">Loading...</p>`;
                loadAllCategories();
            }, "Failed to load your categories.");
            DOM.quickAdd.gridIncome.innerHTML = "";
        }
    }
    
    async function loadCategoriesForForm(type) {
        // (Эта функция не делает fetch, она использует allCategories)
        DOM.fullForm.categorySelect.innerHTML = "<option value=''>Loading...</option>"; 
        const categories = allCategories.filter(c => c.type === type);
        DOM.fullForm.categorySelect.innerHTML = "";
        if (categories.length === 0) {
            DOM.fullForm.categorySelect.innerHTML = "<option value=''>No categories found</option>";
            return;
        }
        categories.forEach(cat => {
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
        const trashIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.58.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.84 0a.75.75 0 01-1.5.06l-.3 7.5a.75.75 0 111.5-.06l.3-7.5z" clip-rule="evenodd" /></svg>`;
        
        const txDate = new Date(tx.date + 'Z');
        const formattedTime = formatTime(txDate); // 👈 Использует formatTime
        
        const { icon: customEmoji, name: categoryName } = parseCategory(tx.category);
        let categoryDisplay;
        
        if (customEmoji) {
            categoryDisplay = `${customEmoji} ${categoryName}`;
        } else if (defaultEmojis[categoryName]) {
            categoryDisplay = `${defaultEmojis[categoryName]} ${categoryName}`;
        } else {
            const defaultIcon = (tx.type === 'income') ? defaultIconIncome : defaultIconExpense;
            categoryDisplay = `${defaultIcon} ${categoryName}`;
        }

        item.innerHTML = `
            <div class="expense-item-delete-bg">
                ${trashIconSvg}
            </div>
            <div class="expense-item-content">
                <div class="tx-info">
                    <span class="tx-category">${categoryDisplay}</span>
                    <span class="tx-time">${formattedTime}</span>
                </div>
                <div class="expense-item-details">
                    <span class="tx-amount ${tx.type}">
                        ${tx.type === 'income' ? '+' : '-'}${formatCurrency(tx.amount)}
                    </span>
                    <button class="edit-btn" data-tx-id="${tx.id}">${editIconSvg}</button>
                </div>
            </div>
        `;
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
                </div>
            `;
            updateBalance(); 
            return;
        }

        let currentHeaderDate = ""; 

        transactions.forEach(tx => {
            const txDate = new Date(tx.date);
            const dateHeader = formatDateForTitle(txDate); // 👈 Использует formatDateForTitle
            
            if (dateHeader !== currentHeaderDate) {
                const headerEl = document.createElement('div');
                headerEl.className = 'date-header';
                headerEl.textContent = dateHeader;
                DOM.home.listContainer.appendChild(headerEl);
                currentHeaderDate = dateHeader; 
            }
            
            const item = createTransactionElement(tx);
            
            if (tx.id === highlightId) {
                item.classList.add('new-item-animation');
                item.addEventListener('animationend', () => {
                    item.classList.remove('new-item-animation');
                }, { once: true });
            }
            
            DOM.home.listContainer.appendChild(item);
        });
        
        updateBalance();
    }

    function renderSkeleton() {
        const skeletonHtml = `
            <div class="skeleton-loader">
                <div class="skeleton-item skeleton-header"></div>
                <div class="skeleton-item skeleton-tx"></div>
                <div class="skeleton-item skeleton-tx"></div>
                <div class="skeleton-item skeleton-tx"></div>
            </div>
        `;
        DOM.home.listContainer.innerHTML = skeletonHtml;
    }
    
    async function loadTransactions(highlightId = null) {
        if (!tgInitData) return; // 👈 Проверяем tgInitData
        try {
            // 🚫 УБРАЛИ: ?user_id=${userId}
            // ✅ ДОБАВИЛИ: { headers: ... }
            const response = await fetch(API_URLS.TRANSACTIONS, {
                headers: getAuthHeaders(false)
            });
            
            if (!response.ok) {
                throw new Error("Network response was not ok");
            }
            allTransactions = await response.json(); 
            renderTransactions(allTransactions, highlightId); 
            isInitialLoad = false;
            
        } catch (error) { 
            renderErrorState(DOM.home.listContainer, () => {
                renderSkeleton();
                loadTransactions();
            }, "Failed to load your transactions.");
        }
    }
    
    function renderQuickAddGrids() {
        DOM.quickAdd.gridExpense.innerHTML = '';
        DOM.quickAdd.gridIncome.innerHTML = '';

        allCategories.forEach(cat => {
            const { icon: customEmoji, name: categoryName } = parseCategory(cat.name);
            let emojiToShow;

            if (customEmoji) {
                emojiToShow = customEmoji;
            } else if (defaultEmojis[categoryName]) {
                emojiToShow = defaultEmojis[categoryName];
            } else {
                emojiToShow = (cat.type === 'income') ? defaultIconIncome : defaultIconExpense;
            }

            const btn = document.createElement('button');
            btn.className = 'category-grid-btn';
            btn.innerHTML = `
                <span class="icon">${emojiToShow}</span>
                <span>${categoryName}</span>
            `;
            
            btn.addEventListener('click', () => {
                openQuickModal(cat); 
            });
            
            if (cat.type === 'income') {
                DOM.quickAdd.gridIncome.appendChild(btn);
            } else {
                DOM.quickAdd.gridExpense.appendChild(btn);
            }
        });
    }
    
    // ---
    // --- Логика Форм (Add/Edit)
    // ---
    
    function handleEditTransactionClick(e) {
        const editBtn = e.target.closest('.edit-btn');
        if (!editBtn) return;
        
        const txId = parseInt(editBtn.dataset.txId, 10);
        const transactionToEdit = allTransactions.find(tx => tx.id === txId);
        
        if (transactionToEdit) {
            openEditScreen(transactionToEdit);
        }
    }

    async function openEditScreen(tx) {
        currentEditTransaction = tx;
        DOM.fullForm.title.textContent = "Edit Transaction";
        DOM.fullForm.saveBtn.textContent = "Save Changes";
        DOM.fullForm.deleteBtn.classList.remove("hidden");

        if (DOM.fullForm.typeWrapper) {
            DOM.fullForm.typeWrapper.classList.add("hidden");
        }
        
        if (tx.type === 'income') {
            DOM.fullForm.typeIncome.classList.add('active');
            DOM.fullForm.typeExpense.classList.remove('active');
        } else {
            DOM.fullForm.typeExpense.classList.add('active');
            DOM.fullForm.typeIncome.classList.remove('active');
        }
        
        DOM.fullForm.amountInput.value = tx.amount;
        DOM.fullForm.dateInput.value = new Date(tx.date).toISOString().split('T')[0];
        
        await loadCategoriesForForm(tx.type); 
        DOM.fullForm.categorySelect.value = tx.category_id;
        
        closeBottomSheet(); 
        showScreen('full-form-screen');
    }
    
    function openAddScreen() {
        currentEditTransaction = null;
        showScreen('quick-add-screen');
    }

    async function openFullForm(type = 'expense') {
        currentEditTransaction = null;
        DOM.fullForm.title.textContent = (type === 'income') ? "New Income" : "New Expense";
        DOM.fullForm.saveBtn.textContent = "Save Transaction";
        DOM.fullForm.deleteBtn.classList.add("hidden");
        
        if (DOM.fullForm.typeWrapper) {
            DOM.fullForm.typeWrapper.classList.add("hidden");
        }
        
        DOM.fullForm.amountInput.value = ""; 
        DOM.fullForm.dateInput.valueAsDate = new Date();
        
        if (type === 'income') {
            DOM.fullForm.typeIncome.classList.add('active');
            DOM.fullForm.typeExpense.classList.remove('active');
        } else {
            DOM.fullForm.typeExpense.classList.add('active');
            DOM.fullForm.typeIncome.classList.remove('active');
        }
        
        await loadCategoriesForForm(type);
        showScreen('full-form-screen');
    }
    
    async function deleteTransaction(txId) {
        if (!tgInitData) return false; // 👈 Проверяем tgInitData
        try {
            // 🚫 УБРАЛИ: ?user_id=${userId}
            // ✅ ДОБАВИЛИ: { method: ..., headers: ... }
            const response = await fetch(`${API_URLS.TRANSACTIONS}/${txId}`, { 
                method: 'DELETE',
                headers: getAuthHeaders(false)
            });
            if (!response.ok) {
                await handleFetchError(response, "Failed to delete transaction");
                return false;
            }
            return true; 
        } catch (error) {
            tg.showAlert("Failed to delete transaction.");
            return false; 
        }
    }
    
    function showDeleteConfirmation() {
        if (!currentEditTransaction) return;
        const txId = currentEditTransaction.id;
        
        tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
            if (confirmed) {
                DOM.fullForm.saveBtn.disabled = true; 
                DOM.fullForm.deleteBtn.disabled = true;
                
                const success = await deleteTransaction(txId); 
                
                if (success) {
                    tg.HapticFeedback.notificationOccurred('success');
                    await loadTransactions(); 
                    showScreen('home-screen');
                }
                
                DOM.fullForm.saveBtn.disabled = false; 
                DOM.fullForm.deleteBtn.disabled = false;
                currentEditTransaction = null;
            }
        });
    }

    async function _saveTransaction(txData, txId = null) {
        let url = API_URLS.TRANSACTIONS;
        let method = 'POST';
        let body = txData;
        
        if (txId) { 
            // 🚫 УБРАЛИ: ?user_id=${txData.user_id}
            url = `${API_URLS.TRANSACTIONS}/${txId}`; // 👈 СТАЛО ЧИСТО
            method = 'PATCH';
            body = { 
                category_id: txData.category_id, 
                amount: txData.amount, 
                date: txData.date 
            };
        }

        try {
            const response = await fetch(url, {
                method: method, 
                // ✅ ДОБАВИЛИ: headers
                headers: getAuthHeaders(true), // true, так как JSON body
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                await handleFetchError(response, "Failed to save transaction.");
                return null;
            }
            return await response.json();
        } catch (error) {
            console.error("Save transaction failed:", error);
            tg.showAlert("An error occurred while saving.");
            return null;
        }
    }

    async function handleSaveForm() {
        const categoryId = DOM.fullForm.categorySelect.value;
        const amount = parseFloat(DOM.fullForm.amountInput.value);
        const date = DOM.fullForm.dateInput.value;
        
        if (!categoryId || isNaN(amount) || amount <= 0 || !date) {
            tg.showAlert("Please fill all fields with valid data.");
            return;
        }
        if (!tgInitData) return; // 👈 Проверяем tgInitData
        
        DOM.fullForm.saveBtn.disabled = true;

        // 🚫 УБРАЛИ: const userIdString = String(userId);
        
        const txData = { 
            // 🚫 УБРАЛИ: user_id: userIdString,
            category_id: parseInt(categoryId), 
            amount: amount, 
            date: date 
        };
        const txId = currentEditTransaction ? currentEditTransaction.id : null;
        
        const savedTransaction = await _saveTransaction(txData, txId);
        
        if (savedTransaction) {
            tg.HapticFeedback.notificationOccurred('success');
            await loadTransactions(txId ? null : savedTransaction.id); 
            showScreen('home-screen');
        }
        
        DOM.fullForm.saveBtn.disabled = false;
        currentEditTransaction = null;
    }
    
    // ---
    // --- Логика "Шторок" (Bottom Sheet)
    // ---
    
    function openBottomSheet(sheetElement) {
        if (!sheetElement) return;

        if (activeBottomSheet && activeBottomSheet !== sheetElement) {
             activeBottomSheet.style.transform = 'translateY(100%)';
             setTimeout(() => activeBottomSheet.classList.add('hidden'), 300);
        }

        DOM.backdrop.classList.remove('hidden');
        sheetElement.classList.remove('hidden');
        document.body.classList.add('is-sheet-open');
        
        setTimeout(() => { 
            DOM.backdrop.classList.add('shown');
            sheetElement.style.transform = 'translateY(0)'; 
        }, 10);
        
        activeBottomSheet = sheetElement;
        tg.HapticFeedback.impactOccurred('light');
    }

    function closeBottomSheet() {
        if (!activeBottomSheet) return;

        document.body.classList.remove('is-sheet-open');
        DOM.backdrop.classList.remove('shown');
        activeBottomSheet.style.transform = 'translateY(100%)'; 
        
        const sheetToHide = activeBottomSheet;
        activeBottomSheet = null; 
        
        setTimeout(() => {
            sheetToHide.classList.add('hidden');
            if (!activeBottomSheet) {
                DOM.backdrop.classList.add('hidden');
            }
        }, 300); 
    }
    
    function openQuickModal(category) {
        currentQuickCategory = category; 
        
        const { name: categoryName } = parseCategory(category.name);
        DOM.quickModal.title.textContent = categoryName;
        DOM.quickModal.currency.textContent = currentCurrencySymbol;
        DOM.quickModal.amountInput.value = '';
        
        DOM.quickModal.saveBtn.className = 'save-btn'; 
        if (category.type === 'expense') {
            DOM.quickModal.saveBtn.classList.add('expense');
            DOM.quickModal.saveBtn.textContent = "Save Expense";
        } else {
            DOM.quickModal.saveBtn.classList.add('income');
            DOM.quickModal.saveBtn.textContent = "Save Income";
        }
        
        openBottomSheet(DOM.quickModal.sheet);
        setTimeout(() => DOM.quickModal.amountInput.focus(), 300);
    }

    async function saveQuickModal() {
        const amount = parseFloat(DOM.quickModal.amountInput.value);
        if (!currentQuickCategory) return;
        
        const categoryId = currentQuickCategory.id;
        const date = getLocalDateString(new Date());

        if (isNaN(amount) || amount <= 0) {
            tg.showAlert("Please enter a valid amount."); return;
        }
        if (!tgInitData) return; // 👈 Проверяем tgInitData
        
        DOM.quickModal.saveBtn.disabled = true;
        
        // 🚫 УБРАЛИ: const userIdString = String(userId);
        
        const txData = { 
            // 🚫 УБРАЛИ: user_id: userIdString,
            category_id: parseInt(categoryId), 
            amount: amount, 
            date: date 
        };
        
        const savedTransaction = await _saveTransaction(txData); // Используем _saveTransaction
        
        if (savedTransaction) {
            tg.HapticFeedback.notificationOccurred('success');
            closeBottomSheet();
            await loadTransactions(savedTransaction.id);
            showScreen('home-screen');
        }
        
        DOM.quickModal.saveBtn.disabled = false;
    }

    function openDaySheet(date) {
        DOM.daySheet.title.textContent = formatDateForTitle(date); // 👈 Использует formatDateForTitle
        
        const dayStart = new Date(date).setHours(0, 0, 0, 0);
        const dayEnd = new Date(date).setHours(23, 59, 59, 999);
        
        const dayTransactions = allTransactions.filter(tx => {
            const txDate = new Date(tx.date).getTime();
            return txDate >= dayStart && txDate <= dayEnd;
        });
        
        DOM.daySheet.list.innerHTML = "";
        if (dayTransactions.length === 0) {
            DOM.daySheet.list.innerHTML = "<p class='list-placeholder'>No transactions on this day.</p>";
        } else {
            dayTransactions.forEach(tx => {
                const item = createTransactionElement(tx);
                DOM.daySheet.list.appendChild(item);
            });
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
            
            let touchY = e.touches[0].clientY;
            let diffY = touchY - startY;

            if (diffY > 0) {
                e.preventDefault(); 
                currentY = diffY;
                sheet.style.transform = `translateY(${diffY}px)`;
            }
        };

        const handleTouchEnd = (e) => {
            if (!isDragging) return;
            
            isDragging = false;
            sheet.style.transition = 'transform 0.3s ease-out';

            if (currentY > 100) { 
                closeFn();
            } else {
                sheet.style.transform = 'translateY(0)';
            }
            currentY = 0;
            
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };

        header.addEventListener('touchstart', (e) => {
            if (content && content.scrollTop > 0) {
                isDragging = false;
                return;
            }
            isDragging = true;
            startY = e.touches[0].clientY;
            sheet.style.transition = 'none';
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);
        }, { passive: true }); 
    }
    
    // ---
    // --- Логика Свайпов (Swipe-to-Delete)
    // ---
    
    function handleSwipeStart(e) {
        const txItem = e.target.closest('.expense-item');
        if (!txItem || e.target.closest('.edit-btn') || isSwiping) { 
            return;
        }
        currentSwipeElement = txItem;
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
    }

    function handleSwipeMove(e) {
        if (!currentSwipeElement) return;
        
        const diffX = e.touches[0].clientX - swipeStartX;
        const diffY = e.touches[0].clientY - swipeStartY;
        
        if (!isSwiping) {
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
                isSwiping = true;
            } else if (Math.abs(diffY) > Math.abs(diffX)) {
                currentSwipeElement = null; 
                return;
            }
        }
        
        if (isSwiping) {
            e.preventDefault(); 
            const content = currentSwipeElement.querySelector('.expense-item-content');
            if (!content) return;
            
            let moveX = diffX;
            if (moveX > 0) moveX = 0; 
            
            const maxSwipe = -SWIPE_DELETE_BG_WIDTH;
            if (moveX < maxSwipe) {
                moveX = maxSwipe - Math.pow(-moveX + maxSwipe, 0.7);
            }
            
            content.classList.add('swiping');
            content.style.transform = `translateX(${moveX}px)`;
        }
    }

    function handleSwipeEnd(e) {
        if (!currentSwipeElement) return;
        
        const content = currentSwipeElement.querySelector('.expense-item-content');
        if (!content) return;
        
        content.classList.remove('swiping');
        const currentTransform = new DOMMatrix(getComputedStyle(content).transform).m41;
        
        if (isSwiping && currentTransform <= SWIPE_THRESHOLD) {
            content.style.transform = `translateX(-${SWIPE_DELETE_BG_WIDTH}px)`;
            handleDeleteSwipe(currentSwipeElement, content);
        } else {
            content.style.transform = 'translateX(0)';
        }
        
        currentSwipeElement = null;
        isSwiping = false;
    }
    
    function handleDeleteSwipe(element, content) {
        const editBtn = element.querySelector('.edit-btn');
        if (!editBtn) return;

        const txId = parseInt(editBtn.dataset.txId, 10);
        tg.HapticFeedback.impactOccurred('medium');

        tg.showConfirm("Are you sure you want to delete this transaction?", async (confirmed) => {
            if (confirmed) {
                element.style.height = element.offsetHeight + 'px';
                requestAnimationFrame(() => {
                    element.classList.add('deleting');
                    element.style.height = '0px';
                    element.style.margin = '0px';
                    element.style.padding = '0px';
                });
                
                element.addEventListener('transitionend', async () => {
                    await deleteTransaction(txId);
                    await loadTransactions();
                }, { once: true });

            } else {
                content.style.transform = 'translateX(0)';
            }
        });
    }

    // ---
    // --- Аналитика (Analytics)
    // ---
    
    async function loadAnalyticsPage() {
        if (!tgInitData) return; // 👈 Проверяем tgInitData
        if (DOM.analytics.summaryPane.classList.contains('hidden')) {
            await loadCalendarData();
        } else {
            await loadSummaryData();
        }
    }

    async function loadSummaryData() {
        DOM.analytics.summaryList.innerHTML = `<p class="list-placeholder">Loading summary...</p>`;
        if (currentChart) currentChart.destroy();
        DOM.analytics.doughnutChartCanvas.classList.add('hidden');
        
        if (!tgInitData) return; // 👈 Проверяем tgInitData

        let url = new URL(API_URLS.ANALYTICS_SUMMARY, window.location.origin);
        // 🚫 УБРАЛИ: url.searchParams.append('user_id', userId);
        url.searchParams.append('type', 'expense');
        url.searchParams.append('range', currentSummaryRange);
        
        try {
            // ✅ ДОБАВИЛИ: { headers: ... }
            const response = await fetch(url.toString(), {
                headers: getAuthHeaders(false)
            }); 
            if (!response.ok) throw new Error("Failed to load summary");
            const data = await response.json();
            
            DOM.analytics.summaryList.innerHTML = "";
            
            if (data.length === 0) {
                DOM.analytics.summaryList.innerHTML = `<p class="list-placeholder">No expenses found for this period.</p>`;
                return;
            }
            
            DOM.analytics.doughnutChartCanvas.classList.remove('hidden');
            const labels = data.map(item => parseCategory(item.category).name); 
            const totals = data.map(item => item.total);
            
            data.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'summary-list-item';
                
                const { icon, name } = parseCategory(item.category); 
                let categoryDisplay;
                
                if (icon) {
                    categoryDisplay = `${icon} ${name}`;
                } else if (defaultEmojis[name]) {
                    categoryDisplay = `${defaultEmojis[name]} ${name}`;
                } else {
                    categoryDisplay = `${defaultIconExpense} ${name}`;
                }

                itemEl.innerHTML = `
                    <span class="category">${categoryDisplay}</span>
                    <span class="amount">-${formatCurrency(item.total)}</span>
                `;
                DOM.analytics.summaryList.appendChild(itemEl);
            });

            if (currentChart) {
                currentChart.destroy();
            }
            
            currentChart = new Chart(DOM.analytics.doughnutChartCanvas, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Expenses', data: totals,
                        backgroundColor: ['#FFB6C1', '#FFDAB9', '#FFFFE0', '#98FB98', '#AFEEEE', '#ADD8E6', '#E6E6FA', '#FADADD', '#FDE6D2', '#FBF0D0'],
                        borderWidth: 0,
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: getComputedStyle(document.body).getPropertyValue('--tg-theme-text-color'),
                                usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 16
                            }
                        }
                    }
                }
            });

        } catch (error) {
            renderErrorState(DOM.analytics.summaryList, () => {
                DOM.analytics.summaryList.innerHTML = `<p class="list-placeholder">Loading summary...</p>`;
                loadSummaryData();
            }, "Failed to load summary data.");
            if (currentChart) currentChart.destroy();
            DOM.analytics.doughnutChartCanvas.classList.add('hidden');
        }
    }
    
    function populateDatePickers() {
        const currentMonth = currentAnalyticsDate.getMonth(); 
        const currentYear = currentAnalyticsDate.getFullYear();
        
        DOM.calendar.monthSelect.innerHTML = "";
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        months.forEach((month, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = month;
            if (index === currentMonth) option.selected = true;
            DOM.calendar.monthSelect.appendChild(option);
        });

        DOM.calendar.yearSelect.innerHTML = "";
        for (let year = currentYear - 5; year <= currentYear + 1; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === currentYear) option.selected = true;
            DOM.calendar.yearSelect.appendChild(option);
        }
    }

    async function loadCalendarData() {
        if (!tgInitData) return; // 👈 Проверяем tgInitData

        const year = currentAnalyticsDate.getFullYear();
        const month = currentAnalyticsDate.getMonth() + 1; 
        
        populateDatePickers(); 
        DOM.calendar.summaryIncome.textContent = '...';
        DOM.calendar.summaryExpense.textContent = '...';
        DOM.calendar.summaryNet.textContent = '...';
        DOM.calendar.container.innerHTML = '<p class="list-placeholder">Loading calendar...</p>';

        try {
            // 🚫 УБРАЛИ: &user_id=${userId}
            // ✅ ДОБАВИЛИ: { headers: ... }
            const response = await fetch(`${API_URLS.ANALYTICS_CALENDAR}?month=${month}&year=${year}`, {
                headers: getAuthHeaders(false)
            });
            
            if (!response.ok) throw new Error("Failed to load calendar data");
            const data = await response.json();
            
            DOM.calendar.summaryIncome.textContent = `+${formatCurrency(data.month_summary.income)}`;
            DOM.calendar.summaryExpense.textContent = `-${formatCurrency(data.month_summary.expense)}`;
            DOM.calendar.summaryNet.textContent = `${data.month_summary.net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(data.month_summary.net))}`;
            DOM.calendar.summaryNet.style.color = data.month_summary.net >= 0 ? 'var(--color-income)' : 'var(--color-expense)';

            DOM.calendar.container.innerHTML = ''; 
            
            const firstDayOfMonth = new Date(year, month - 1, 1);
            const lastDayOfMonth = new Date(year, month, 0);
            const today = new Date();
            const todayString = today.toDateString();

            const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            weekdays.forEach(day => {
                const headerEl = document.createElement('div');
                headerEl.className = 'calendar-day-header';
                headerEl.textContent = day;
                DOM.calendar.container.appendChild(headerEl);
            });
            
            let startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; 
            for (let i = 0; i < startDayOfWeek; i++) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'calendar-day is-other-month';
                DOM.calendar.container.appendChild(emptyEl);
            }
            
            for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
                const currentDate = new Date(year, month - 1, day);
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day';
                
                if (currentDate.toDateString() === todayString) {
                    dayEl.classList.add('is-today');
                }

                const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                let markersHtml = '';
                if (data.days[dayKey]) {
                    const dayData = data.days[dayKey];
                    if (dayData.income > 0) markersHtml += `<span class="income">+${dayData.income.toFixed(0)}</span>`;
                    if (dayData.expense > 0) markersHtml += `<span class="expense">-${dayData.expense.toFixed(0)}</span>`;
                }

                dayEl.innerHTML = `
                    <div class="day-number">${day}</div>
                    <div class="day-marker">${markersHtml}</div>
                `;
                
                dayEl.addEventListener('click', () => {
                    openDaySheet(currentDate);
                });
                
                DOM.calendar.container.appendChild(dayEl);
            }
            
        } catch (error) {
            renderErrorState(DOM.calendar.container, () => {
                DOM.calendar.container.innerHTML = '<p class="list-placeholder">Loading calendar...</p>';
                loadCalendarData();
            }, "Failed to load calendar data.");
        }
    }
    
    // ---
    // --- AI Advisor
    // ---
    
    async function fetchAiData(promptType, title) {
        if (!tgInitData) { tg.showAlert("User ID not found."); return; } // 👈 Проверяем tgInitData
        
        tg.HapticFeedback.impactOccurred('medium');
        
        DOM.ai.featuresList.classList.add('hidden');
        DOM.ai.resultContainer.classList.remove('hidden');
        DOM.ai.resultTitle.textContent = title;
        DOM.ai.resultBody.textContent = "Thinking...";

        try {
            // 🚫 УБРАЛИ: &user_id=${userId}
            const url = `${API_URLS.AI_ADVICE}?range=${currentAiRange}&prompt_type=${promptType}`;
            
            // ✅ ДОБАВИЛИ: { headers: ... }
            const response = await fetch(url, {
                headers: getAuthHeaders(false)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Failed to get response from AI.");
            }
            const data = await response.json();
            DOM.ai.resultBody.textContent = data.advice;
        } catch (error) {
            DOM.ai.resultBody.innerHTML = `
                <div class="list-placeholder" style="padding: 20px 0;">
                    <span class="icon">☁️</span>
                    <h3 style="font-size: 1.1rem;">Couldn't Connect</h3>
                    <p>${error.message || "Failed to get response from AI."}</p>
                    <button class="placeholder-btn">Retry</button>
                </div>
            `;
            const retryBtn = DOM.ai.resultBody.querySelector('.placeholder-btn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    tg.HapticFeedback.impactOccurred('light');
                    fetchAiData(promptType, title);
                });
            }
        }
    }
    
    // ---
    // --- Настройки (Settings) и Категории (Categories)
    // ---
    
    async function handleResetData() {
        if (!tgInitData) return; // 👈 Проверяем tgInitData
        
        DOM.settings.resetDataBtn.disabled = true;
        DOM.settings.resetDataBtn.textContent = "Resetting...";

        try {
            // 🚫 УБРАЛИ: ?user_id=${userId}
            // ✅ ДОБАВИЛИ: { method: ..., headers: ... }
            const response = await fetch(API_URLS.USER_RESET, { 
                method: 'DELETE',
                headers: getAuthHeaders(false)
            });
            if (!response.ok) {
                await handleFetchError(response, "Failed to reset data");
                throw new Error("Reset failed");
            }

            tg.HapticFeedback.notificationOccurred('success');
            await loadTransactions();
            await loadAllCategories();
            showScreen('home-screen');
            
            tg.showPopup({
                title: 'Data Reset',
                message: `Your account has been successfully reset.`,
                buttons: [{ type: 'ok' }]
            });

        } catch (error) { 
            // Ошибка уже показана
        } finally {
            DOM.settings.resetDataBtn.disabled = false;
            DOM.settings.resetDataBtn.textContent = "Reset All Data"; 
        }
    }
    
    function loadCategoriesScreen() {
        DOM.categories.list.innerHTML = "";
        const categories = allCategories.filter(c => c.type === currentCategoryManagementType);
        renderCategoriesList(categories);
    }

    function renderCategoriesList(categories = []) {
        DOM.categories.list.innerHTML = "";
        
        if (categories.length === 0) {
            DOM.categories.list.innerHTML = `
                <div class="list-placeholder" style="padding: 40px 20px;">
                    <span class="icon">🏷️</span>
                    <h3>No Categories Yet</h3>
                    <p>
                        Use the form above to add your
                        first ${currentCategoryManagementType} category.
                    </p>
                </div>
            `;
            return;
        }

        categories.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-item';
            
            let deleteButtonHtml = '';
            if (cat.user_id !== null) {
                deleteButtonHtml = `
                    <button class="delete-category-btn" data-id="${cat.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                `;
            }

            item.innerHTML = `
                <span>${cat.name}</span>
                ${deleteButtonHtml}
            `;
            
            DOM.categories.list.appendChild(item);
        });
    }

    async function handleAddCategory() {
        const icon = DOM.categories.newIconInput.value.trim();
        const name = DOM.categories.newNameInput.value.trim();
        
        if (!name) {
            tg.showAlert('Please enter a category name.');
            return;
        }

        const fullName = icon ? `${icon} ${name}` : name;
        
        if (!tgInitData) return; // 👈 Проверяем tgInitData

        tg.HapticFeedback.impactOccurred('light');
        DOM.categories.addBtn.disabled = true;
        
        // 🚫 УБРАЛИ: const userIdString = String(userId);
        
        try {
            const response = await fetch(API_URLS.CATEGORIES, {
                method: 'POST',
                // ✅ ДОБАВИЛИ: headers
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    // 🚫 УБРАЛИ: user_id: userIdString,
                    name: fullName,
                    type: currentCategoryManagementType
                }),
            });
            if (!response.ok) {
                 await handleFetchError(response, "Failed to add category");
                 throw new Error("Add failed");
            }
            
            DOM.categories.newIconInput.value = "";
            DOM.categories.newNameInput.value = "";
            
            await loadAllCategories(); 
            loadCategoriesScreen(); 
            
        } catch (error) {
            // Ошибка уже показана
        } finally {
            DOM.categories.addBtn.disabled = false;
        }
    }

    async function handleDeleteCategory(categoryId) {
        let transactionCount = 0;
        let message = "Are you sure you want to delete this category?";

        if (!tgInitData) return; // 👈 Проверяем tgInitData

        try {
            // 🚫 УБРАЛИ: &user_id=${userId}
            // ✅ ДОБАВИЛИ: { headers: ... }
            const checkResponse = await fetch(`${API_URLS.CATEGORIES}/${categoryId}/check`, {
                headers: getAuthHeaders(false)
            });
            if (!checkResponse.ok) {
                await handleFetchError(checkResponse, "Failed to check category");
                return;
            }
            const checkData = await checkResponse.json();
            transactionCount = checkData.transaction_count;
        } catch (error) {
            tg.showAlert("Failed to check category.");
            return;
        }

        if (transactionCount > 0) {
            const txWord = transactionCount === 1 ? 'transaction' : 'transactions';
            message = `Warning: This category is linked to ${transactionCount} ${txWord}. Deleting it will also delete all associated transactions.\n\nAre you sure you want to proceed?`;
        }

        tg.showConfirm(message, async (confirmed) => {
            if (confirmed) {
                try {
                    // 🚫 УБРАЛИ: ?user_id=${userId}
                    // ✅ ДОБАВИЛИ: { method: ..., headers: ... }
                    const deleteResponse = await fetch(`${API_URLS.CATEGORIES}/${categoryId}`, {
                        method: 'DELETE',
                        headers: getAuthHeaders(false)
                    });
                    if (!deleteResponse.ok) {
                        await handleFetchError(deleteResponse, "Failed to delete");
                        throw new Error("Delete failed");
                    }
                    
                    tg.HapticFeedback.notificationOccurred('success');
                    await loadAllCategories(); 
                    loadCategoriesScreen(); 
                    
                } catch (error) {
                    // Ошибка уже показана
                }
            }
        });
    }

    // ---
    // --- Инициализация и Слушатели событий
    // ---
    
    function applyTelegramThemeColors() {
        if (tg.colorScheme === 'dark') {
            tg.setHeaderColor('#1C1C1E');
            tg.setBackgroundColor('#1C1C1E');
        } else {
            // Используем #FFFFFF, как в твоем оригинальном файле
            const lightBgColor = '#FFFFFF'; 
            tg.setHeaderColor(lightBgColor);
            tg.setBackgroundColor(lightBgColor);
        }
    }
    
    function init() {
        
        // 1. Фикс для Android (который у тебя уже был)
        if (tg.platform === 'android' || tg.platform === 'android_x') {
            document.body.classList.add('platform-android');
        }
        
        // 2. ВОЗВРАЩАЕМ ТЕМУ:
        applyTelegramThemeColors();
        tg.onEvent('themeChanged', applyTelegramThemeColors);
        
        // 3. --- Навигация ---
        DOM.tabs.home.addEventListener('click', () => { showScreen('home-screen'); tg.HapticFeedback.impactOccurred('light'); });
        DOM.tabs.analytics.addEventListener('click', () => { showScreen('analytics-screen'); tg.HapticFeedback.impactOccurred('light'); });
        DOM.tabs.ai.addEventListener('click', () => { showScreen('ai-screen'); tg.HapticFeedback.impactOccurred('light'); });
        DOM.tabs.settings.addEventListener('click', () => { showScreen('settings-screen'); tg.HapticFeedback.impactOccurred('light'); });
        DOM.tabs.add.addEventListener('click', () => { openAddScreen(); tg.HapticFeedback.impactOccurred('medium'); });

        // 4. --- Формы ---
        DOM.fullForm.cancelBtn.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('light'); showScreen(lastActiveScreen); }); 
        DOM.fullForm.saveBtn.addEventListener('click', () => handleSaveForm());
        DOM.fullForm.deleteBtn.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('heavy'); showDeleteConfirmation(); });
        
        // 5. --- Быстрое добавление (Quick Add) ---
        DOM.quickAdd.manualExpense.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('medium'); openFullForm('expense'); });
        DOM.quickAdd.manualIncome.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('medium'); openFullForm('income'); });
        DOM.quickAdd.manageBtn.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('light'); showScreen('categories-screen'); });
        DOM.quickModal.saveBtn.addEventListener('click', saveQuickModal);
        
        // 6. --- Шторки (Sheets) ---
        DOM.backdrop.addEventListener('click', closeBottomSheet);
        setupSheetDrag(DOM.daySheet.sheet, DOM.daySheet.header, DOM.daySheet.contentWrapper, closeBottomSheet);
        setupSheetDrag(DOM.quickModal.sheet, DOM.quickModal.header, null, closeBottomSheet);
        
        // 7. --- Аналитика ---
        DOM.analytics.segBtnSummary.addEventListener('click', () => {
            tg.HapticFeedback.impactOccurred('light');
            DOM.analytics.summaryPane.classList.remove('hidden');
            DOM.analytics.calendarPane.classList.add('hidden');
            DOM.analytics.segBtnSummary.classList.add('active');
            DOM.analytics.segBtnCalendar.classList.remove('active');
            sessionStorage.setItem('lastAnalyticsTab', 'summary');
            loadAnalyticsPage(); 
        });
        DOM.analytics.segBtnCalendar.addEventListener('click', () => {
            tg.HapticFeedback.impactOccurred('light');
            DOM.analytics.summaryPane.classList.add('hidden');
            DOM.analytics.calendarPane.classList.remove('hidden');
            DOM.analytics.segBtnSummary.classList.remove('active');
            DOM.analytics.segBtnCalendar.classList.add('active');
            sessionStorage.setItem('lastAnalyticsTab', 'calendar');
            loadAnalyticsPage(); 
        });
        DOM.analytics.summaryRangeFilter.addEventListener('click', (e) => {
            const target = e.target.closest('.seg-button');
            if (!target) return;
            const range = target.dataset.range;
            if (!range) return;
            tg.HapticFeedback.impactOccurred('light');
            DOM.analytics.summaryRangeFilter.querySelectorAll('.seg-button').forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');
            currentSummaryRange = range;
            loadSummaryData(); 
        });
        DOM.calendar.prevMonthBtn.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('light'); currentAnalyticsDate.setMonth(currentAnalyticsDate.getMonth() - 1); loadCalendarData(); });
        DOM.calendar.nextMonthBtn.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('light'); currentAnalyticsDate.setMonth(currentAnalyticsDate.getMonth() + 1); loadCalendarData(); });
        DOM.calendar.monthSelect.addEventListener('change', () => { tg.HapticFeedback.impactOccurred('light'); currentAnalyticsDate.setMonth(parseInt(DOM.calendar.monthSelect.value)); loadCalendarData(); });
        DOM.calendar.yearSelect.addEventListener('change', () => { tg.HapticFeedback.impactOccurred('light'); currentAnalyticsDate.setFullYear(parseInt(DOM.calendar.yearSelect.value)); loadCalendarData(); });
        
        // 8. --- AI Советник ---
        DOM.ai.dateFilter.addEventListener('click', (e) => {
            const target = e.target.closest('.seg-button');
            if (!target) return;
            const range = target.dataset.range;
            if (!range) return;
            tg.HapticFeedback.impactOccurred('light');
            DOM.ai.dateFilter.querySelectorAll('.seg-button').forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');
            currentAiRange = range;
            const periodText = (range === 'all') ? "all-time" : `this ${range}'s`;
            DOM.ai.btnAdvice.querySelector('p').textContent = `An actionable tip based on ${periodText} spending.`;
            DOM.ai.btnSummary.querySelector('p').textContent = `A quick summary of totals for ${periodText}.`;
            DOM.ai.btnAnomaly.querySelector('p').textContent = `Find the largest single expense for ${periodText}.`;
        });
        DOM.ai.btnAdvice.addEventListener('click', () => fetchAiData('advice', "Here's your Advice"));
        DOM.ai.btnSummary.addEventListener('click', () => {
            const rangeText = currentAiRange.charAt(0).toUpperCase() + currentAiRange.slice(1);
            fetchAiData('summary', `Here's your ${rangeText} Summary`);
        });
        DOM.ai.btnAnomaly.addEventListener('click', () => {
            const rangeText = currentAiRange.charAt(0).toUpperCase() + currentAiRange.slice(1);
            fetchAiData('anomaly', `Largest Expense This ${rangeText}`);
        });
        DOM.ai.resultBackBtn.addEventListener('click', () => {
            tg.HapticFeedback.impactOccurred('light');
            DOM.ai.resultContainer.classList.add('hidden');
            DOM.ai.featuresList.classList.remove('hidden');
        });
        
        // 9. --- Настройки (Settings) ---
        DOM.settings.currencySelect.addEventListener('change', (e) => {
            const newSymbol = e.target.value;
            tg.HapticFeedback.impactOccurred('light');
            tg.CloudStorage.setItem('currency_symbol', newSymbol, (err, success) => {
                if (err) { tg.showAlert('Error saving currency: '.concat(err)); return; }
                if (success) {
                    currentCurrencySymbol = newSymbol;
                    loadTransactions(); 
                    tg.showPopup({
                        title: 'Currency Updated',
                        message: `Your default currency is now ${newSymbol}.`,
                        buttons: [{ type: 'ok' }]
                    });
                }
            });
        });
        DOM.settings.resetDataBtn.addEventListener('click', () => {
            tg.HapticFeedback.impactOccurred('heavy');
            tg.showConfirm(
                "Are you sure? All your transactions and custom categories will be deleted. This action cannot be undone.",
                (confirmed) => { if (confirmed) handleResetData(); }
            );
        });
        
        // 10. --- Категории (Categories) ---
        DOM.categories.backBtn.addEventListener('click', () => { tg.HapticFeedback.impactOccurred('light'); showScreen(lastActiveScreen); });
        DOM.categories.segBtnExpense.addEventListener('click', () => {
            tg.HapticFeedback.impactOccurred('light');
            currentCategoryManagementType = 'expense';
            DOM.categories.segBtnExpense.classList.add('active');
            DOM.categories.segBtnIncome.classList.remove('active');
            loadCategoriesScreen();
        });
        DOM.categories.segBtnIncome.addEventListener('click', () => {
            tg.HapticFeedback.impactOccurred('light');
            currentCategoryManagementType = 'income';
            DOM.categories.segBtnExpense.classList.remove('active');
            DOM.categories.segBtnIncome.classList.add('active');
            loadCategoriesScreen();
        });
        DOM.categories.addBtn.addEventListener('click', handleAddCategory);
        DOM.categories.list.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-category-btn');
            if (deleteBtn) {
                const categoryId = deleteBtn.dataset.id;
                handleDeleteCategory(categoryId);
            }
        });
        
        // 11. --- Делегированные слушатели (Свайпы и Редактирование) ---
        document.body.addEventListener('click', handleEditTransactionClick);
        [DOM.home.listContainer, DOM.daySheet.list].forEach(list => {
            list.addEventListener('touchstart', handleSwipeStart, { passive: true });
            list.addEventListener('touchmove', handleSwipeMove, { passive: false });
            list.addEventListener('touchend', handleSwipeEnd);
        });

        // 12. --- Запуск ---
        // 🚫 УБРАЛИ: if (!userId)
        // ✅ СДЕЛАЛИ: if (!tgInitData)
        if (!tgInitData) {
             showScreen('home-screen');
             DOM.home.listContainer.innerHTML = "<p class='list-placeholder'>Authentication data not found. Please run this app inside Telegram.</p>";
             return;
        }

        const lastScreenId = sessionStorage.getItem('lastActiveScreen') || 'home-screen';
        showScreen(lastScreenId);
        if (lastScreenId === 'home-screen') {
            renderSkeleton();
        }

        tg.CloudStorage.getItem('currency_symbol', async (err, value) => {
            if (value) {
                currentCurrencySymbol = value;
            } else {
                currentCurrencySymbol = "$";
            }
            DOM.settings.currencySelect.value = currentCurrencySymbol;
            
            await Promise.all([
                loadAllCategories(),
                loadTransactions()
            ]);
        });
    }
    
    // --- ЗАПУСК ---
    init();
});