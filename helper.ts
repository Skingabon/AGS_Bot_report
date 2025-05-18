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
