export function createApiRequest({ tg, tgInitData }) {
  return async function apiRequest(url, options = {}) {
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
  };
}
