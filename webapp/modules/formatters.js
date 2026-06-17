export function parseDateFromUTC(dateString) {
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

const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
const headerDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const preciseNumberFormatter = new Intl.NumberFormat("en-US", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatDateForTitle = (date) => headerDateFormatter.format(date);
export const formatTime = (date) => timeFormatter.format(date);

export function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseCategory(fullName) {
  if (!fullName) return { icon: null, name: "" };
  const emojiRegex = /^(\p{Extended_Pictographic}|\p{Emoji})(\p{Emoji_Modifier}|\uFE0F)*/u;
  const match = fullName.match(emojiRegex);
  if (match && match[0]) {
    return { icon: match[0], name: fullName.substring(match[0].length).trim() };
  }
  return { icon: null, name: fullName.trim() };
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

export function formatForDayMarker(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num === 0) return "";

  const absAmount = Math.abs(Math.round(num));
  const sign = num < 0 ? "-" : "+";
  if (absAmount >= 1000000) return `${sign}${(absAmount / 1000000).toFixed(1)}M`;
  if (absAmount >= 1000) return `${sign}${(absAmount / 1000).toFixed(0)}K`;
  return `${sign}${absAmount}`;
}
