// export const getDate = (time: number): string => {
//   const unixTimestamp = time; // Пример числа из created_at
//
//   const date = new Date(unixTimestamp * 1000); // Умножаем на 1000 для миллисекунд
//   const formattedDate = date.toLocaleString('ru-RU', {
//     day: 'numeric',
//     month: 'numeric',
//     year: 'numeric',
//     hour: '2-digit',
//     minute: '2-digit',
//   });
//   return formattedDate; // "05.04.2024, 15:34" (MSK)
// };
//

import { CustomFields } from '../interfaces';

export const getDate = (time: number): string => {
  const date = new Date(time * 1000);

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${year}.${month}.${day} ${hours}:${minutes}`;
};

export const getPeriodTimestamps = (
  dateString1: string,
  dateString2?: string,
): [number, number] => {
  // Валидация формата дат
  const validateDate = (dateStr: string) => {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
      throw new Error(
        `Неверный формат даты: ${dateStr}. Используйте DD.MM.YYYY`,
      );
    }
    const [day, month, year] = dateStr.split('.').map(Number);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      throw new Error(`Неверная дата: ${dateStr}`);
    }

    return date;
  };

  const startDate = validateDate(dateString1);
  const endDate = dateString2 ? validateDate(dateString2) : new Date(startDate);

  // Проверка, что начальная дата не позже конечной
  if (startDate > endDate) {
    throw new Error('Начальная дата не может быть позже конечной');
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return [
    Math.floor(startDate.getTime() / 1000),
    Math.floor(endDate.getTime() / 1000),
  ];
};

//Вычисляю разницу во времени между датами создания и распределения на рук-отдела серии и распр на инж - распр на рук отдела серии
// Парсит дату из строки формата "YYYY.MM.DD HH:MM"
export function parseCustomDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // Разбиваем строку "2025.04.22 15:30" на части
  const [datePart, timePart] = dateStr.split(' ');
  if (!datePart || !timePart) return null;

  const [year, month, day] = datePart.split('.').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  // Проверяем валидность данных
  if (
    isNaN(year) ||
    isNaN(month) ||
    isNaN(day) ||
    isNaN(hours) ||
    isNaN(minutes)
  ) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes);
}
// Безопасный парс даты из строки
export function safeParseDate(str: string | null): Date | null {
  if (!str) return null;
  return parseCustomDate(str);
}

// Конвертирует разницу в миллисекундах в "HH:MM"
export function formatDiff(ms: number): string {
  if (ms <= 0) return '00:00';

  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function getCurrentTime() {
  return `${new Date().getHours()}:${new Date().getMinutes()}`;
}

//новые поля
export function getFieldValue(
  fields: CustomFields[],
  fieldName: string,
): string | null {
  const field = fields.find((f) => f.field_name === fieldName);
  return field?.values?.[0]?.value || null;
}

//// Форматирует дату в "YYYY.MM.DD HH:MM" (например, "2025.04.22 15:30")
export function formatDate(value: string | number | null): string {
  if (!value) return '';

  const date = new Date(Number(value) * 1000);
  if (isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}.${month}.${day} ${hours}:${minutes}`;
}

export const formatDateByPeriod = (inputDate: string): string => {
  const [day, month, year] = inputDate.split('.').map(Number);

  const formattedYear = year.toString();
  const formattedMonth = month.toString().padStart(2, '0');
  const formattedDay = day.toString().padStart(2, '0');

  // Возвращаем дату в нужном формате
  return `${formattedYear}-${formattedMonth}-${formattedDay}T00:00:00`;
};

export function convertDateFormat(dateString: string): string | null {
  // Проверяем, соответствует ли строка ожидаемому формату YYYY.MM.DD
  const regex = /^(\d{4})\.(\d{2})\.(\d{2})$/;
  const match = dateString.match(regex);

  if (!match) {
    console.log('Неверный формат даты. Ожидается: YYYY.MM.DD');
    return null;
  }

  // Извлекаем компоненты даты
  const year = match[1];
  const month = match[2];
  const day = match[3];

  // Формируем новую дату в формате DD.MM.YYYY
  return `${day}.${month}.${year}`;
}

export type returnTypeParseDate = { day: number; month: number; year: number };

export function parseDate(dateString: string): returnTypeParseDate {
  // Разделяем строку по пробелу и берем только часть с датой
  const datePart = dateString.split(' ')[0];

  // Разделяем дату по точкам
  const [year, month, day] = datePart.split('.').map(Number);

  // Возвращаем объект с нужными значениями
  return {
    day: day,
    month: month,
    year: year % 100, // Берем последние две цифры года
  };
}
// Parse DD.MM.YYYY HH:SS as Date
export const parseDateTime = (dateString: string): Date | null => {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  const cleanString = dateString.trim();

  console.log(`Парсим: "${cleanString}"`); // для отладки

  try {
    // Формат: "YYYY.MM.DD HH:MM"
    const match = cleanString.match(
      /^(\d{4})\.(\d{1,2})\.(\d{1,2}) (\d{1,2}):(\d{1,2})$/,
    );

    if (!match) {
      console.log(
        `❌ Не соответствует формату YYYY.MM.DD HH:MM: "${cleanString}"`,
      );
      return null;
    }

    const [, yearStr, monthStr, dayStr, hoursStr, minutesStr] = match;

    // Преобразуем в числа
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    // Валидация
    if (
      day < 1 ||
      day > 31 ||
      month < 1 ||
      month > 12 ||
      year < 2000 ||
      year > 2100 ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      console.log(
        `❌ Неверные компоненты даты: ${year}.${month}.${day} ${hours}:${minutes}`,
      );
      return null;
    }

    // Создаем дату (секунды = 0)
    const date = new Date(year, month - 1, day, hours, minutes, 0);

    // Проверяем что дата создалась корректно
    if (isNaN(date.getTime())) {
      console.log(`❌ Некорректная дата: ${dateString}`);
      return null;
    }

    console.log(`✅ Успешно: "${cleanString}" -> ${date.toISOString()}`);
    return date;
  } catch (error) {
    console.log(`❌ Ошибка парсинга "${cleanString}":`, error);
    return null;
  }
};
