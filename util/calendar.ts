// utils/calendar.ts
import { Context, InlineKeyboard } from 'grammy';

// utils/calendar.ts
export class TelegramCalendar {
  static generateMonth(year: number, month: number): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    const monthNames = [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ];

    // Заголовок с навигацией (фиксированная ширина)
    keyboard
      .text('◀️', `cal_prev_${year}_${month}`)
      .text(`${monthNames[month]} ${year}`, 'cal_header')
      .text('▶️', `cal_next_${year}_${month}`)
      .row();

    // Дни недели (фиксированная строка)
    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekDays.forEach((day) => {
      keyboard.text(day, `cal_day_${day}`);
    });
    keyboard.row();

    // Получаем информацию о месяце
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const firstDayOfWeek = (firstDay.getDay() + 6) % 7; // Пн = 0, Вс = 6

    // Всегда 6 строк для единообразия
    let dayCounter = 1;

    for (let week = 0; week < 6; week++) {
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const position = week * 7 + dayOfWeek;

        if (week === 0 && dayOfWeek < firstDayOfWeek) {
          // Пустые ячейки перед первым днем месяца
          keyboard.text(' ', `cal_empty_${position}`);
        } else if (dayCounter <= daysInMonth) {
          // Дни месяца
          const dateStr = `${dayCounter.toString().padStart(2, '0')}.${(month + 1).toString().padStart(2, '0')}.${year}`;
          keyboard.text(dayCounter.toString(), `cal_date_${dateStr}`);
          dayCounter++;
        } else {
          // Пустые ячейки после последнего дня месяца
          keyboard.text(' ', `cal_empty_${position}`);
        }
      }

      // Новая строка после каждой недели (кроме последней)
      if (week < 5) {
        keyboard.row();
      }
    }

    return keyboard;
  }

  static getCurrentMonth(): { year: number; month: number } {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
    };
  }
}

// Навигация по месяцам
export const changeMonth = async (ctx: Context) => {
  if (!ctx.match) return;
  const direction = ctx.match[1];
  let year = parseInt(ctx.match[2]);
  let month = parseInt(ctx.match[3]);

  if (direction === 'prev') {
    month--;
    if (month < 0) {
      month = 11;
      year--;
    }
  } else {
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  await ctx.editMessageText('📅 Выберите дату:', {
    reply_markup: TelegramCalendar.generateMonth(year, month),
  });
  await ctx.answerCallbackQuery();
};
