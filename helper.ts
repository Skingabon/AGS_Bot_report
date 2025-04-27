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
