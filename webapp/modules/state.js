export function createInitialState() {
  return {
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
}
