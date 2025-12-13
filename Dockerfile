# Используем легкий Python 3.12
FROM python:3.12-slim

# Рабочая папка внутри контейнера
WORKDIR /app

# Сначала копируем только зависимости (чтобы кэшировать их)
COPY requirements.txt .

# Устанавливаем библиотеки
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь остальной код проекта
COPY . .

# Открываем порт 8000
EXPOSE 8000

# Запускаем приложение через uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]