export const getDate = (time: number): string => {
  const unixTimestamp = time; // Пример числа из created_at

  const date = new Date(unixTimestamp * 1000); // Умножаем на 1000 для миллисекунд
  const formattedDate = date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formattedDate; // "05.04.2024, 15:34" (MSK)
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
