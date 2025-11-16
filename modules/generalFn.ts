import { Context } from 'grammy';
import { updateAllFiled, updateIncomingCall } from './updateFields';
import {
  createReportTimeByPeriod,
  getReportMarketing,
  showReportLeadByPeriod,
} from './timeReport';
import { sendGoogleSheetLinkByEmail } from './emailSender';
import { isHasAccess } from '../auth/auth';
import { TelegramCalendar } from '../util/calendar';
import { getBaseMenu, getBossMenu } from './keyboards';

export let botContext: Context | null = null;

const calendarReport = async (
  ctx: Context,
  calendarType:
    | 'awaiting_start_date_marketing'
    | 'awaiting_start_date_report_time'
    | 'awaiting_start',
) => {
  if (!ctx.from) return;
  const userId = ctx.from.id;
  calendarStates[userId] = { type: calendarType };

  const { year, month } = TelegramCalendar.getCurrentMonth();

  await ctx.editMessageText('📅 Выберите <b>начальную дату</b> периода:', {
    parse_mode: 'HTML',
    reply_markup: TelegramCalendar.generateMonth(year, month),
  });

  await ctx.answerCallbackQuery();
};

const calendarStates: Record<
  number,
  | {
      type: 'awaiting_start' | 'awaiting_end';
      startDate?: string;
    }
  | {
      type: 'awaiting_start_date_report_time' | 'awaiting_end_date_report_time';
      startDate?: string;
    }
  | {
      type: 'awaiting_start_date_marketing' | 'awaiting_end_date_marketing';
      startDate?: string;
    }
  | null
> = {};

// Стартовые команды
export const fnStartingCommand = async (ctx: Context) => {
  botContext = ctx;
  if (ctx.from) {
    calendarStates[ctx.from.id] = null;
  }
  await ctx.reply('Выберите команду:', {
    reply_markup: getBaseMenu(ctx),
  });
};

export const accessCreateReport = async (ctx: Context) => {
  // Проверяем, не аутентифицирован ли уже пользователь
  const hasAccess = isHasAccess(ctx);

  if (hasAccess) {
    await ctx.reply('Команды для руководства:', {
      reply_markup: getBossMenu(),
    });
  } else {
    await ctx.reply('У вас нет доступа.');
  }

  await ctx.answerCallbackQuery();
};

// Отчеты с выбором дат
export const reportLeadPeriod = async (ctx: Context) => {
  await calendarReport(ctx, 'awaiting_start');
};
export const protectedReportTimePeriod = async (ctx: Context) => {
  await calendarReport(ctx, 'awaiting_start_date_report_time');
};
export const protectedReportMarketing = async (ctx: Context) => {
  await calendarReport(ctx, 'awaiting_start_date_marketing');
};

export const reportLeadYesterday = async (ctx: Context) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = yesterday.toLocaleDateString('ru-Ru');
  await showReportLeadByPeriod(ctx, yesterdayDate);
  await ctx.answerCallbackQuery();
};
export const reportLeadToday = async (ctx: Context) => {
  const currentDate = new Date().toLocaleDateString('ru-RU');
  await showReportLeadByPeriod(ctx, currentDate);
  await ctx.answerCallbackQuery();
};

// Защищенные обработчики
export const protectedSetIncomingCall = async (ctx: Context) => {
  await ctx.reply('Обновляю динамические поля');
  await updateAllFiled();
  await ctx.reply('Обрабатываю исходящие звонки');
  await updateIncomingCall();
  await ctx.reply('Все готово!');
};

export const protectedReportTimeLastDay = async (ctx: Context) => {
  await ctx.reply('Начинаю создавать таблицу со всеми статическими полям');
  await createReportTimeByPeriod();
  await ctx.reply('Обновляю динамические поля');
  await updateAllFiled();
  await ctx.reply('Обрабатываю исходящие звонки');
  await updateIncomingCall();
  await ctx.reply('Все готово!');
};

export const protectedSendGoogleLink = async (ctx: Context) => {
  try {
    const userEmail = process.env.RECEIVER_EMAIL;
    const googleSheetUrl = process.env.GOOGLE_SHEET_URL;

    if (!userEmail || !googleSheetUrl) {
      await ctx.reply('Email или ссылка не настроены в .env');
      return;
    }

    await sendGoogleSheetLinkByEmail(userEmail, googleSheetUrl);
    await ctx.reply('Ссылка на Google Таблицу отправлена на почту!');
  } catch (err) {
    console.error(err);
    await ctx.reply(`Ошибка при отправке на почту: ${err}`);
  }
  await ctx.answerCallbackQuery();
};

export const onChangeDatePeriod = async (ctx: Context) => {
  if (!ctx.from || !ctx.match) return;
  const userId = ctx.from.id;
  const selectedDate = ctx.match[1]; // DD.MM.YYYY
  const state = calendarStates[userId];

  if (!state) {
    await ctx.answerCallbackQuery('❌ Сессия устарела');
    return;
  }

  if (state.type === 'awaiting_start') {
    state.startDate = selectedDate;
    state.type = 'awaiting_end';

    const { year, month } = TelegramCalendar.getCurrentMonth();

    await ctx.editMessageText(
      `✅ Начальная дата: <b>${selectedDate}</b>\n\n` +
        'Теперь выберите <b>конечную дату</b>:',
      {
        parse_mode: 'HTML',
        reply_markup: TelegramCalendar.generateMonth(year, month),
      },
    );
  } else if (state.type === 'awaiting_end' && state.startDate) {
    const endDate = selectedDate;

    await ctx.editMessageText(
      `✅ Период выбран:\n` +
        `📅 С: ${state.startDate}\n` +
        `📅 По: ${endDate}\n\n` +
        `⏳ Формирую отчет...`,
    );

    // Вызываем вашу функцию
    await showReportLeadByPeriod(ctx, state.startDate, endDate);

    delete calendarStates[userId];
  } else if (state.type === 'awaiting_start_date_report_time') {
    state.startDate = selectedDate;
    state.type = 'awaiting_end_date_report_time';

    const { year, month } = TelegramCalendar.getCurrentMonth();

    await ctx.editMessageText(
      `✅ Начальная дата: <b>${selectedDate}</b>\n\n` +
        'Теперь выберите <b>конечную дату</b>:',
      {
        parse_mode: 'HTML',
        reply_markup: TelegramCalendar.generateMonth(year, month),
      },
    );
  } else if (
    state.type === 'awaiting_end_date_report_time' &&
    state.startDate
  ) {
    const endDate = selectedDate;

    await ctx.editMessageText(
      `✅ Период выбран:\n` +
        `📅 С: ${state.startDate}\n` +
        `📅 По: ${endDate}\n\n` +
        `⏳ Формирую отчет...`,
    );

    // Вызываем вашу функцию
    await ctx.reply('Начинаю создавать таблицу со всеми статическими полям');
    await createReportTimeByPeriod(state.startDate, endDate);
    await ctx.reply('Обновляю динамические поля');
    await updateAllFiled();
    await ctx.reply('Обрабатываю исходящие звонки');
    await updateIncomingCall();

    delete calendarStates[userId];
  } else if (state.type === 'awaiting_start_date_marketing') {
    state.startDate = selectedDate;
    state.type = 'awaiting_end_date_marketing';

    const { year, month } = TelegramCalendar.getCurrentMonth();

    await ctx.editMessageText(
      `✅ Начальная дата: <b>${selectedDate}</b>\n\n` +
        'Теперь выберите <b>конечную дату</b>:',
      {
        parse_mode: 'HTML',
        reply_markup: TelegramCalendar.generateMonth(year, month),
      },
    );
  } else if (state.type === 'awaiting_end_date_marketing' && state.startDate) {
    const endDate = selectedDate;

    await ctx.editMessageText(
      `✅ Период выбран:\n` +
        `📅 С: ${state.startDate}\n` +
        `📅 По: ${endDate}\n\n` +
        `⏳ Формирую отчет...`,
    );

    // Вызываем вашу функцию
    const response = await getReportMarketing(ctx, state.startDate, endDate);
    if (response) {
      const { countActiveLead, countClosed, pipelinesSeriesIng, totalLeads } =
        response;

      await ctx.reply(
        `Отчет за период готов! Найдено сделок: ${totalLeads}\n
         1. Лид: ${countActiveLead}\n 
         2. Квалифицировано: ${pipelinesSeriesIng} \n
         3. Отказ: ${countClosed}\n `,
      );
    }

    delete calendarStates[userId];
  }

  await ctx.answerCallbackQuery();
};
