import 'dotenv/config';
import cron from 'node-cron';
import { Bot, Context, InlineKeyboard } from 'grammy';
import {
  createReportTimeByPeriod,
  getReportLeadByPeriod,
  showReportLeadByPeriod,
  showReportLeadByYesterday,
  updateAllFiled,
  updateIncomingCall,
} from './modules/timeReport';
import { sendGoogleSheetLinkByEmail } from './modules/emailSender';

const bot = new Bot(process.env.BOT_API_KEY || '');
let botContext: Context | null = null;

// Расширим тип UserState
type UserState =
  | { type: 'awaiting_start_date' }
  | { type: 'awaiting_end_date'; startDate: string }
  | { type: 'awaiting_start_date_report_time' }
  | { type: 'awaiting_end_date_report_time'; startDateReportTime: string }
  | { type: 'awaiting_start_date_marketing' }
  | { type: 'awaiting_end_date_marketing'; startDateMarketing: string }
  | { type: 'password' }
  | { type: 'authenticated'; authenticatedAt: Date } // Новое состояние для аутентифицированных пользователей
  | null;

const userStates: Record<number, UserState> = {};

// Добавим интерфейс для защищенных функций
interface ProtectedHandler {
  (ctx: Context): Promise<void>;
}

// Функция проверки доступа
const checkAccess = async (ctx: Context): Promise<boolean> => {
  if (!ctx.from) return false;

  const userId = ctx.from.id;
  const state = userStates[userId];

  // Если пользователь уже аутентифицирован
  if (state?.type === 'authenticated') {
    // Проверяем, не истекла ли сессия (например, 5 минут)
    const sessionTimeout = 5 * 60 * 1000; // 5 минут в миллисекундах
    if (Date.now() - state.authenticatedAt.getTime() > sessionTimeout) {
      userStates[userId] = null; // Сбрасываем сессию
      return false;
    }
    return true;
  }

  return false;
};

// Декоратор для защищенных функций
const withAccessCheck = (handler: ProtectedHandler): ProtectedHandler => {
  return async (ctx: Context) => {
    const hasAccess = await checkAccess(ctx);

    if (!hasAccess) {
      const userId = ctx.from?.id;
      if (userId) {
        userStates[userId] = { type: 'password' };
      }

      const backBtn = new InlineKeyboard()
        .text('Вернуться в меню', 'menu')
        .row();

      await ctx.reply('Требуется авторизация. Введите пароль:', {
        reply_markup: backBtn,
      });
      return;
    }

    await handler(ctx);
  };
};

// Защищенные обработчики
const protectedGenerate = withAccessCheck(async (ctx) => {
  await updateAllFiled(ctx);
  await updateIncomingCall(ctx);
});

const protectedReportTimeLastDay = withAccessCheck(async (ctx) => {
  await createReportTimeByPeriod(ctx);
  await updateAllFiled(ctx);
  await updateIncomingCall(ctx);
});

const protectedReportTimePeriod = withAccessCheck(async (ctx) => {
  if (!ctx.from) return;

  const userId = ctx.from.id;
  userStates[userId] = { type: 'awaiting_start_date_report_time' };

  await ctx.reply(
    'Введите НАЧАЛЬНУЮ дату периода в формате DD.MM.YYYY (например, 01.04.2025)',
  );
  await ctx.answerCallbackQuery();
});

const protectedSendGoogleLink = withAccessCheck(async (ctx) => {
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
});

const protectedReportMarketing = withAccessCheck(async (ctx) => {
  if (!ctx.from) return;

  const userId = ctx.from.id;
  userStates[userId] = { type: 'awaiting_start_date_marketing' };

  await ctx.reply(
    'Введите НАЧАЛЬНУЮ дату периода в формате DD.MM.YYYY (например, 01.04.2025)',
  );
  await ctx.answerCallbackQuery();
});

bot.api.setMyCommands([
  { command: 'start', description: 'Start AGS_Bot_Report' },
]);

const menuKeyboard = new InlineKeyboard()
  .text('Для руководства', 'access-create-report')
  .row()
  .text('Отчет по сделкам за вчерашний день', 'report-lead-yesterday')
  .row()
  .text('Отчет по сделкам за сегодня', 'report-lead-today')
  .row()
  .text('Отчет по сделкам за период', 'report-lead-period')
  .row();

const bossMenu = new InlineKeyboard()
  .text('Маркетинг', 'report-marketing-period')
  .row()
  .text('Создать отчет за последний день', 'report-time-last-day')
  .row()
  .text('Создать отчет за выбранный период', 'report-time-period')
  .row()
  //TODO Изменить логику заполнения поля Первое качание - если дата/время первого касапния младше даты создания сделки....
  .text('Заполнить исходящие звонки', 'generate')
  .row()
  .text('Отправить ссылку на Google Таблицу на почту', 'send-google-link')
  .row()
  .text('Вернуться в меню', 'menu')
  .row();

const fnStartingCommand = async (ctx: Context) => {
  botContext = ctx;
  if (ctx.from) {
    userStates[ctx.from.id] = null;
  }
  await ctx.reply('Выберите команду:', {
    reply_markup: menuKeyboard,
  });
};

bot.command('start', fnStartingCommand);

bot.callbackQuery('generate', protectedGenerate);
bot.callbackQuery('report-time-last-day', protectedReportTimeLastDay);
bot.callbackQuery('report-time-period', protectedReportTimePeriod);
bot.callbackQuery('send-google-link', protectedSendGoogleLink);
bot.callbackQuery('report-marketing-period', protectedReportMarketing);

bot.callbackQuery('report-lead-yesterday', async (ctx) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDate = yesterday.toLocaleDateString('ru-Ru');
  await showReportLeadByYesterday(ctx, yesterdayDate);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('report-lead-today', async (ctx) => {
  const currentDate = new Date().toLocaleDateString('ru-RU');
  await showReportLeadByPeriod(ctx, currentDate);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('report-lead-period', async (ctx) => {
  const userId = ctx.from.id;
  userStates[userId] = { type: 'awaiting_start_date' };

  await ctx.reply(
    'Введите НАЧАЛЬНУЮ дату периода в формате DD.MM.YYYY (например, 01.04.2025)',
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('menu', fnStartingCommand);

bot.callbackQuery('access-create-report', async (ctx) => {
  const userId = ctx.from.id;

  // Проверяем, не аутентифицирован ли уже пользователь
  const hasAccess = await checkAccess(ctx);

  if (hasAccess) {
    await ctx.reply('Команды для руководства:', {
      reply_markup: bossMenu,
    });
  } else {
    userStates[userId] = { type: 'password' };
    await ctx.reply('Введите пароль для доступа к командам руководства:');
  }

  await ctx.answerCallbackQuery();
});

bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];

  if (!state) return;

  const userInput = ctx.message.text;

  if (state.type === 'password') {
    if (userInput === process.env.BOSS_BTN_PASSWORD) {
      // Устанавливаем состояние аутентификации
      userStates[userId] = {
        type: 'authenticated',
        authenticatedAt: new Date(),
      };

      await ctx.reply('✅Команды для руководства:', {
        reply_markup: bossMenu,
      });
      return;
    } else {
      const backBtn = new InlineKeyboard()
        .text('Вернуться в меню', 'menu')
        .row();

      await ctx.reply('❌ Неверный пароль. Попробуйте еще раз:', {
        reply_markup: backBtn,
      });
      return;
    }
  }

  // Проверка формата даты
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(userInput)) {
    await ctx.reply(
      'Неверный формат даты. Пожалуйста, введите дату в формате DD.MM.YYYY',
    );
    return;
  }

  if (state.type === 'awaiting_start_date_report_time') {
    userStates[userId] = {
      type: 'awaiting_end_date_report_time',
      startDateReportTime: userInput,
    };
    await ctx.reply(
      'Теперь введите КОНЕЧНУЮ дату периода в формате DD.MM.YYYY',
    );
  } else if (state.type === 'awaiting_end_date_report_time') {
    const startDate = state.startDateReportTime;
    const endDate = userInput;

    userStates[userId] = { type: 'authenticated', authenticatedAt: new Date() };

    await createReportTimeByPeriod(ctx, startDate, endDate);
    await updateAllFiled(ctx);
    await updateIncomingCall(ctx);
  } else if (state.type === 'awaiting_start_date') {
    userStates[userId] = {
      type: 'awaiting_end_date',
      startDate: userInput,
    };
    await ctx.reply(
      'Теперь введите КОНЕЧНУЮ дату периода в формате DD.MM.YYYY',
    );
  } else if (state.type === 'awaiting_end_date') {
    const startDate = state.startDate;
    const endDate = userInput;

    userStates[userId] = { type: 'authenticated', authenticatedAt: new Date() };

    await showReportLeadByPeriod(ctx, startDate, endDate);
  } else if (state.type === 'awaiting_start_date_marketing') {
    userStates[userId] = {
      type: 'awaiting_end_date_marketing',
      startDateMarketing: userInput,
    };
    await ctx.reply(
      'Теперь введите КОНЕЧНУЮ дату периода в формате DD.MM.YYYY',
    );
  } else if (state.type === 'awaiting_end_date_marketing') {
    const startDate = state.startDateMarketing;
    const endDate = userInput;

    userStates[userId] = { type: 'authenticated', authenticatedAt: new Date() };

    const response = await getReportLeadByPeriod(ctx, startDate, endDate);
    if (response) {
      const {
        inProgress,
        countIng,
        countSeries,
        countClosed,
        pipelineSeries,
        pipelineIng,
      } = response;
      // const period = !endDate ? 'сегодня' : `период: ${startDate}-${endDate}`;

      const periodOutput = `Отчет за период: ${startDate}-${endDate}`;
      await ctx.reply(
        `${periodOutput}
1. Лид: <b>${inProgress}</b>
2. Квалифицировано: <b>${countIng + countSeries}</b>
3. В работе: <b>${pipelineSeries + pipelineIng}</b>
4. Закрыто и нереализовано: <b>${countClosed}</b>`,
        {
          parse_mode: 'HTML',
        },
      );
    }
  }
});

//Ежедневное заполнение отчета в 23.50
cron.schedule('50 23 * * *', async () => {
  console.log('Запуск ежедневного обновления...');
  await createReportTimeByPeriod(botContext).catch(console.error);
  await updateAllFiled(botContext).catch(console.error);
  await updateIncomingCall(botContext).catch(console.error);
});

//Ежедневная отправка ссылки неа отчет в 9.00
cron.schedule('00 09 * * *', async () => {
  console.log('Запуск ежедневного отчета на почту...');
  try {
    const userEmail = process.env.RECEIVER_EMAIL; // куда отправляем письмо
    const googleSheetUrl = process.env.GOOGLE_SHEET_URL; // ссылка на гугл-таблицу

    if (!userEmail || !googleSheetUrl) {
      return console.log('Неверные данные');
    }

    await sendGoogleSheetLinkByEmail(userEmail, googleSheetUrl);
    if (botContext) {
      await botContext.reply('Ссылка на Google Таблицу отправлена на почту!');
    }
  } catch (err) {
    console.error(err);
    if (botContext) {
      await botContext.reply(`Ошибка при отправке на почту: ${err}`);
    }
  }
});

bot.start();
