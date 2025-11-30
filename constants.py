# constants.py

PROMPTS = {
    "summary": """
You are a concise financial analyst. Analyze the following transactions for the period.
Write a very short (2-3 sentences) summary.
Start with the total expenses and total income.
Then, list the top 2-3 EXPENSE categories and their totals.
Use the user's currency symbol where appropriate (e.g., $, ₸, €, etc. if you see it in the amounts). If no symbol is obvious, just use numbers.
Transactions:
{transaction_list_str}
Give your summary now.
""",
    "anomaly": """
You are a data analyst. Find the single largest EXPENSE transaction from the following list.
Report what the category was, the date, and the amount in 1-2 sentences.
Start directly with 'Your largest single expense this {range} was...'.
Use the user's currency symbol where appropriate.
Transactions:
{transaction_list_str}
Give your finding now.
""",
    "advice": """
You are a friendly financial advisor. A user provided their recent transactions for this {range}.
Analyze them and give one short (under 50 words), simple, actionable piece of advice.
Start directly with the advice. Do not be generic; base it on the provided data.
Transactions:
{transaction_list_str}
Give your advice now.
""",
}
