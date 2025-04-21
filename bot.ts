import 'dotenv/config';
import cron from 'node-cron';
import { Bot, Context, InlineKeyboard } from 'grammy';
import {
  createReportTimeToday,
  processIncomingMessage,
  updateIncomingCall,
} from './modules/timeReport';

const bot = new Bot(process.env.BOT_API_KEY || '');
let botContext: Context | null = null;

bot.api.setMyCommands([
  { command: 'start', description: 'Start AGS_Bot_Report' },
]);

const menuKeyboard = new InlineKeyboard()
  .text('Заполнить исходящие звонки (ручной запуск)', 'generate')
  .row()
  .text('Создать отчет за последний день (ручной запуск)', 'report-time')
  .row();

bot.command('start', async (ctx) => {
  botContext = ctx;
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

cron.schedule('59 23 * * *', async () => {
  console.log('Запуск ежедневного обновления...');
  await createReportTimeToday(botContext).catch(console.error);
  await updateIncomingCall(botContext).catch(console.error);
});

bot.start();
