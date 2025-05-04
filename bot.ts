import 'dotenv/config';
import cron from 'node-cron';
import { Bot, Context, InlineKeyboard } from 'grammy';
import {
  createReportTimeToday,
  showReportLeadByPeriod,
  updateIncomingCall,
} from './modules/timeReport';

const bot = new Bot(process.env.BOT_API_KEY || '');
let botContext: Context | null = null;

// Расширенная система состояний
type UserState =
  | { type: 'awaiting_start_date' }
  | { type: 'awaiting_end_date'; startDate: string }
  | null;

const userStates: Record<number, UserState> = {};

bot.api.setMyCommands([
  { command: 'start', description: 'Start AGS_Bot_Report' },
]);

const menuKeyboard = new InlineKeyboard()

  .text('Заполнить исходящие звонки (ручной запуск )', 'generate')
  .row()
  .text('Создать отчет за последний день (ручной запуск)', 'report-time')
  .row()
  .text('Отчет по сделкам за сегодня', 'report-lead-today')
  .row()
  .text('Отчет по сделкам за период', 'report-lead-period')
  .row();

bot.command('start', async (ctx) => {
  botContext = ctx;
  if (ctx.from) {
    userStates[ctx.from.id] = null;
  }
  await ctx.reply('Выберите команду:', {
    reply_markup: menuKeyboard,
  });
});

bot.callbackQuery('generate', async (ctx) => {
  await updateIncomingCall(ctx);
});

bot.callbackQuery('report-time', async (ctx) => {
  await createReportTimeToday(ctx);
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

bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];

  if (!state) return;

  const dateInput = ctx.message.text;

  // Проверка формата даты
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dateInput)) {
    await ctx.reply(
      'Неверный формат даты. Пожалуйста, введите дату в формате DD.MM.YYYY',
    );
    return;
  }

  if (state.type === 'awaiting_start_date') {
    userStates[userId] = {
      type: 'awaiting_end_date',
      startDate: dateInput,
    };
    await ctx.reply(
      'Теперь введите КОНЕЧНУЮ дату периода в формате DD.MM.YYYY',
    );
  } else if (state.type === 'awaiting_end_date') {
    const startDate = state.startDate;
    const endDate = dateInput;

    userStates[userId] = null;

    await showReportLeadByPeriod(ctx, startDate, endDate);
  }
});

cron.schedule('50 23 * * *', async () => {
  console.log('Запуск ежедневного обновления...');
  await updateIncomingCall(botContext).catch(console.error);
  await createReportTimeToday(botContext).catch(console.error);
});

bot.start();
